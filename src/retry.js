import { RetryError, TimeoutError, AbortError } from './errors.js';
import { calculateDelay } from './backoff.js';
import { withTimeout, createDeadlineController } from './timeout.js';

export const DEFAULT_RETRY_STATUS_CODES = [408, 429, 500, 502, 503, 504];

/**
 * Utility to pause execution for a given duration, respecting an AbortSignal.
 *
 * @param {number} ms - Milliseconds to sleep
 * @param {AbortSignal} [signal] - Optional cancellation signal
 * @returns {Promise<void>}
 */
export function sleep(ms, signal) {
  return new Promise((resolve, reject) => {
    if (signal?.aborted) {
      if (signal.reason instanceof TimeoutError || signal.reason instanceof AbortError) {
        return reject(signal.reason);
      }
      return reject(new AbortError(signal.reason?.message || 'Operation was aborted'));
    }
    if (ms <= 0) return resolve();

    let timer = null;
    let onAbort = null;

    const cleanup = () => {
      if (timer) clearTimeout(timer);
      if (signal && onAbort) signal.removeEventListener('abort', onAbort);
    };

    onAbort = () => {
      cleanup();
      if (signal.reason instanceof TimeoutError || signal.reason instanceof AbortError) {
        reject(signal.reason);
      } else {
        reject(new AbortError(signal.reason?.message || 'Operation was aborted'));
      }
    };

    if (signal) {
      signal.addEventListener('abort', onAbort, { once: true });
    }

    timer = setTimeout(() => {
      cleanup();
      resolve();
    }, ms);
  });
}

/**
 * Default predicate to decide whether to retry based on error or response.
 *
 * @param {Error|null} error - Thrown error (if any)
 * @param {any} response - Value returned from operation (if any)
 * @param {number[]} retryStatusCodes - HTTP status codes to retry
 * @param {boolean} [retryOnTimeout=true] - Whether to retry on TimeoutError
 * @returns {boolean} True if the operation should be retried
 */
export function defaultShouldRetry(
  error,
  response,
  retryStatusCodes = DEFAULT_RETRY_STATUS_CODES,
  retryOnTimeout = true
) {
  // If user aborted, never retry
  if (error instanceof AbortError || error?.name === 'AbortError') {
    return false;
  }

  // If timeout occurred and timeout retries are disabled, do not retry
  if (error instanceof TimeoutError && !retryOnTimeout) {
    return false;
  }

  // 1. Check thrown errors
  if (error) {
    const status = error.status || error.statusCode || error.response?.status;
    if (typeof status === 'number') {
      return retryStatusCodes.includes(status);
    }
    // Generic errors (network down, timeout) are retried by default
    return true;
  }

  // 2. Check resolved responses (e.g. native fetch Response object)
  if (response && typeof response.status === 'number') {
    return retryStatusCodes.includes(response.status);
  }

  return false;
}

/**
 * Executes an async or synchronous function with configurable retries,
 * exponential backoff, per-attempt timeout, overall deadline timeout, and cancellation.
 *
 * @param {Function} fn - Operation to execute: `({ attempt, signal }) => Promise<any> | any`
 * @param {Object} [options]
 * @param {number} [options.retries=3] - Maximum retry attempts after initial failure
 * @param {number} [options.delay=1000] - Initial delay between retries in milliseconds
 * @param {string|boolean} [options.backoff='exponential'] - 'exponential' | 'fixed' (or true/false)
 * @param {number} [options.factor=2] - Exponential backoff multiplier
 * @param {number} [options.maxDelay=30000] - Maximum delay cap in milliseconds
 * @param {boolean} [options.jitter=false] - Apply randomization to delays
 * @param {number} [options.timeout=0] - Per-attempt timeout in milliseconds (0 = disabled)
 * @param {number} [options.attemptTimeout] - Alias for timeout
 * @param {number} [options.overallTimeout=0] - Overall deadline timeout for total execution including delays (0 = disabled)
 * @param {number} [options.totalTimeout] - Alias for overallTimeout
 * @param {boolean} [options.retryOnTimeout=true] - Whether to retry when an attempt times out
 * @param {AbortSignal} [options.signal] - External AbortSignal for manual cancellation
 * @param {number[]} [options.retryStatusCodes] - HTTP status codes to retry
 * @param {Function} [options.shouldRetry] - Custom predicate: `(error, response, context) => boolean`
 * @param {Function} [options.onRetry] - Callback before each retry: `({ attempt, error, response, delay }) => void`
 * @param {boolean} [options.throwOnFailedResponse=false] - If true, throws RetryError when response status fails retry check
 * @returns {Promise<any>} Result of the successful operation
 */
export async function retry(fn, options = {}) {
  if (typeof fn !== 'function') {
    throw new TypeError(`retry() expects first argument to be a function, received ${typeof fn}`);
  }

  const {
    retries = 3,
    delay = 1000,
    backoff = 'exponential',
    factor = 2,
    maxDelay = 30000,
    jitter = false,
    timeout = 0,
    attemptTimeout,
    overallTimeout = 0,
    totalTimeout,
    retryOnTimeout = true,
    signal,
    retryStatusCodes = DEFAULT_RETRY_STATUS_CODES,
    shouldRetry,
    onRetry,
    throwOnFailedResponse = false,
  } = options;

  const perAttemptTimeout = attemptTimeout ?? timeout ?? 0;
  const deadlineTimeout = totalTimeout ?? overallTimeout ?? 0;

  const deadline = createDeadlineController(deadlineTimeout, signal);
  const maxAttempts = Math.max(0, retries) + 1;
  const allErrors = [];

  try {
    for (let attempt = 1; attempt <= maxAttempts; attempt++) {
      // Check if cancellation or overall deadline was triggered
      if (deadline.signal.aborted) {
        if (deadline.isTimedOut() || deadline.signal.reason instanceof TimeoutError) {
          throw deadline.signal.reason || new TimeoutError(`Total retry operation timed out after ${deadlineTimeout}ms`, deadlineTimeout);
        }
        throw new AbortError(deadline.signal.reason?.message || 'Operation was aborted');
      }

      // Compute attempt timeout bounded by remaining overall deadline
      let currentTimeout = perAttemptTimeout;
      if (deadlineTimeout > 0) {
        const remaining = deadline.getRemainingMs();
        if (remaining <= 0) {
          throw new TimeoutError(`Total retry operation timed out after ${deadlineTimeout}ms`, deadlineTimeout);
        }
        currentTimeout = currentTimeout > 0 ? Math.min(currentTimeout, remaining) : remaining;
      }

      let result = undefined;
      let error = null;
      let failed = false;

      try {
        result = await withTimeout(fn, {
          timeout: currentTimeout,
          signal: deadline.signal,
          attempt,
        });
      } catch (err) {
        error = err;
        failed = true;
        allErrors.push(err);
      }

      // If overall deadline expired during execution, terminate immediately
      if (deadline.isTimedOut() || (error instanceof TimeoutError && deadlineTimeout > 0 && deadline.getRemainingMs() <= 0)) {
        throw new TimeoutError(`Total retry operation timed out after ${deadlineTimeout}ms`, deadlineTimeout);
      }

      // If caller aborted, rethrow immediately
      if (error instanceof AbortError || signal?.aborted) {
        throw error || new AbortError('Operation was aborted');
      }

      // Determine if this result/error needs a retry
      let willRetry = false;
      const context = { attempt, retriesLeft: maxAttempts - attempt };

      if (typeof shouldRetry === 'function') {
        willRetry = Boolean(shouldRetry(error, result, context));
      } else {
        willRetry = defaultShouldRetry(error, result, retryStatusCodes, retryOnTimeout);
      }

      // If successful, return result immediately
      if (!failed && !willRetry) {
        return result;
      }

      const hasMoreAttempts = attempt < maxAttempts;

      // Check if there is time left in overall deadline before next retry
      if (deadlineTimeout > 0 && deadline.getRemainingMs() <= 0) {
        throw new TimeoutError(`Total retry operation timed out after ${deadlineTimeout}ms`, deadlineTimeout);
      }

      if (willRetry && hasMoreAttempts) {
        const nextDelay = calculateDelay({
          attempt,
          delay,
          backoff,
          factor,
          maxDelay,
          jitter,
        });

        if (typeof onRetry === 'function') {
          try {
            onRetry({
              attempt,
              nextAttempt: attempt + 1,
              error,
              response: result,
              delay: nextDelay,
            });
          } catch (cbErr) {
            console.error('[RetryFlow] Error in onRetry callback:', cbErr);
          }
        }

        await sleep(nextDelay, deadline.signal);
        continue;
      }

      // All retries exhausted or not retryable
      if (failed) {
        if (allErrors.length > 1) {
          throw new RetryError(`All ${attempt} attempts failed. Last error: ${error?.message || error}`, {
            attempts: attempt,
            lastError: error,
            allErrors,
          });
        }
        throw error;
      }

      if (throwOnFailedResponse && willRetry) {
        throw new RetryError(`Operation completed with unhandled status ${result?.status} after ${attempt} attempts`, {
          attempts: attempt,
          lastError: result,
          allErrors,
        });
      }

      return result;
    }
  } finally {
    deadline.cleanup();
  }
}
