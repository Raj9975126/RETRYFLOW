import { TimeoutError, AbortError } from './errors.js';

/**
 * Creates an AbortController with an overall deadline across all retries and delays.
 *
 * @param {number} [overallTimeout=0] - Overall timeout in milliseconds (0 = no overall timeout)
 * @param {AbortSignal} [parentSignal] - Optional caller AbortSignal
 * @returns {{ controller: AbortController, signal: AbortSignal, cleanup: Function, isTimedOut: Function, getRemainingMs: Function }}
 */
export function createDeadlineController(overallTimeout = 0, parentSignal) {
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

/**
 * Executes an async or synchronous function with timeout and AbortSignal support.
 *
 * @param {Function} fn - Operation to execute: `({ signal, attempt }) => Promise<any> | any`
 * @param {Object} [options]
 * @param {number} [options.timeout=0] - Timeout in milliseconds (0 means no timeout)
 * @param {AbortSignal} [options.signal] - Optional external AbortSignal to cancel execution
 * @param {number} [options.attempt=1] - Current attempt number passed to `fn`
 * @returns {Promise<any>}
 */
export async function withTimeout(fn, { timeout = 0, signal, attempt = 1 } = {}) {
  // Check if caller's signal is already aborted
  if (signal?.aborted) {
    if (signal.reason instanceof TimeoutError || signal.reason instanceof AbortError) {
      throw signal.reason;
    }
    throw new AbortError(signal.reason?.message || 'Operation was aborted before execution');
  }

  // If no timeout and no signal, execute directly
  if (!timeout && !signal) {
    return await fn({ attempt });
  }

  // Create an internal controller to handle timeout cancellation
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
    // 1. Setup external abort listener
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

    // 2. Setup timeout timer
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
