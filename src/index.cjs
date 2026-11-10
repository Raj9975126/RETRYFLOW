/**
 * CommonJS entry point for RetryFlow
 */

class RetryError extends Error {
  constructor(message, { attempts, lastError, allErrors = [] } = {}) {
    super(message);
    this.name = 'RetryError';
    this.attempts = attempts;
    this.lastError = lastError;
    this.allErrors = allErrors;
    if (Error.captureStackTrace) {
      Error.captureStackTrace(this, RetryError);
    }
  }
}

class TimeoutError extends Error {
  constructor(message = 'Operation timed out', timeoutMs) {
    super(message);
    this.name = 'TimeoutError';
    this.timeoutMs = timeoutMs;
    if (Error.captureStackTrace) {
      Error.captureStackTrace(this, TimeoutError);
    }
  }
}

class AbortError extends Error {
  constructor(message = 'Operation was aborted') {
    super(message);
    this.name = 'AbortError';
    if (Error.captureStackTrace) {
      Error.captureStackTrace(this, AbortError);
    }
  }
}

function calculateDelay({
  attempt = 1,
  delay = 1000,
  backoff = 'exponential',
  factor = 2,
  maxDelay = 30000,
  jitter = false,
} = {}) {
  const safeAttempt = Math.max(1, attempt);
  const baseDelay = Math.max(0, delay);
  const safeMax = Math.max(0, maxDelay);
  const isExponential = backoff !== 'fixed' && backoff !== false;

  let computedDelay = baseDelay;
  if (isExponential) {
    computedDelay = baseDelay * Math.pow(factor, safeAttempt - 1);
  }
  computedDelay = Math.min(computedDelay, safeMax);
  if (jitter) {
    computedDelay = Math.floor(Math.random() * (computedDelay + 1));
  }
  return Math.round(computedDelay);
}

function createDeadlineController(overallTimeout = 0, parentSignal) {
  const controller = new AbortController();
  const startTime = Date.now();
  let timerId = null;
  let timedOut = false;
  let onParentAbort = null;

  if (parentSignal) {
    if (parentSignal.aborted) {
      controller.abort(parentSignal.reason);
    } else {
      onParentAbort = () => controller.abort(parentSignal.reason);
      parentSignal.addEventListener('abort', onParentAbort, { once: true });
    }
  }

  if (overallTimeout > 0) {
    timerId = setTimeout(() => {
      timedOut = true;
      controller.abort(new TimeoutError(`Total retry operation timed out after ${overallTimeout}ms`, overallTimeout));
    }, overallTimeout);
  }

  const cleanup = () => {
    if (timerId !== null) {
      clearTimeout(timerId);
      timerId = null;
    }
    if (parentSignal && onParentAbort) {
      parentSignal.removeEventListener('abort', onParentAbort);
      onParentAbort = null;
    }
  };

  const getRemainingMs = () => {
    if (!overallTimeout || overallTimeout <= 0) return Infinity;
    return Math.max(0, overallTimeout - (Date.now() - startTime));
  };

  return {
    controller,
    signal: controller.signal,
    cleanup,
    isTimedOut: () => timedOut,
    getRemainingMs,
  };
}

async function withTimeout(fn, { timeout = 0, signal, attempt = 1 } = {}) {
  if (signal?.aborted) {
    if (signal.reason instanceof TimeoutError || signal.reason instanceof AbortError) {
      throw signal.reason;
    }
    throw new AbortError(signal.reason?.message || 'Operation was aborted before execution');
  }

  if (!timeout && !signal) {
    return await fn({ attempt });
  }

  const internalController = new AbortController();
  let timerId = null;
  let onAbortListener = null;

  const activeSignal = internalController.signal;

  const cleanup = () => {
    if (timerId !== null) {
      clearTimeout(timerId);
      timerId = null;
    }
    if (signal && onAbortListener) {
      signal.removeEventListener('abort', onAbortListener);
      onAbortListener = null;
    }
  };

  const timeoutPromise = new Promise((_, reject) => {
    if (signal) {
      onAbortListener = () => {
        cleanup();
        internalController.abort(signal.reason);
        if (signal.reason instanceof TimeoutError || signal.reason instanceof AbortError) {
          reject(signal.reason);
        } else {
          reject(new AbortError(signal.reason?.message || 'Operation was aborted'));
        }
      };
      signal.addEventListener('abort', onAbortListener, { once: true });
    }

    if (timeout > 0) {
      timerId = setTimeout(() => {
        cleanup();
        const err = new TimeoutError(`Operation timed out after ${timeout}ms`, timeout);
        internalController.abort(err);
        reject(err);
      }, timeout);
    }
  });

  try {
    const executionPromise = Promise.resolve().then(() =>
      fn({ signal: activeSignal, attempt })
    );
    return await Promise.race([executionPromise, timeoutPromise]);
  } finally {
    cleanup();
  }
}

const DEFAULT_RETRY_STATUS_CODES = [408, 429, 500, 502, 503, 504];

function sleep(ms, signal) {
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

function defaultShouldRetry(
  error,
  response,
  retryStatusCodes = DEFAULT_RETRY_STATUS_CODES,
  retryOnTimeout = true
) {
  if (error instanceof AbortError || error?.name === 'AbortError') {
    return false;
  }
  if (error instanceof TimeoutError && !retryOnTimeout) {
    return false;
  }
  if (error) {
    const status = error.status || error.statusCode || error.response?.status;
    if (typeof status === 'number') {
      return retryStatusCodes.includes(status);
    }
    return true;
  }
  if (response && typeof response.status === 'number') {
    return retryStatusCodes.includes(response.status);
  }
  return false;
}

async function retry(fn, options = {}) {
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
      if (deadline.signal.aborted) {
        if (deadline.isTimedOut() || deadline.signal.reason instanceof TimeoutError) {
          throw deadline.signal.reason || new TimeoutError(`Total retry operation timed out after ${deadlineTimeout}ms`, deadlineTimeout);
        }
        throw new AbortError(deadline.signal.reason?.message || 'Operation was aborted');
      }

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

      if (deadline.isTimedOut() || (error instanceof TimeoutError && deadlineTimeout > 0 && deadline.getRemainingMs() <= 0)) {
        throw new TimeoutError(`Total retry operation timed out after ${deadlineTimeout}ms`, deadlineTimeout);
      }

      if (error instanceof AbortError || signal?.aborted) {
        throw error || new AbortError('Operation was aborted');
      }

      let willRetry = false;
      const context = { attempt, retriesLeft: maxAttempts - attempt };

      if (typeof shouldRetry === 'function') {
        willRetry = Boolean(shouldRetry(error, result, context));
      } else {
        willRetry = defaultShouldRetry(error, result, retryStatusCodes, retryOnTimeout);
      }

      if (!failed && !willRetry) {
        return result;
      }

      const hasMoreAttempts = attempt < maxAttempts;

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

module.exports = retry;
module.exports.retry = retry;
module.exports.sleep = sleep;
module.exports.calculateDelay = calculateDelay;
module.exports.withTimeout = withTimeout;
module.exports.createDeadlineController = createDeadlineController;
module.exports.defaultShouldRetry = defaultShouldRetry;
module.exports.DEFAULT_RETRY_STATUS_CODES = DEFAULT_RETRY_STATUS_CODES;
module.exports.RetryError = RetryError;
module.exports.TimeoutError = TimeoutError;
module.exports.AbortError = AbortError;
module.exports.default = retry;
