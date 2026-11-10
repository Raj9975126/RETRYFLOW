export class RetryError extends Error {
  /**
   * @param {string} message 
   * @param {Object} details 
   * @param {number} details.attempts 
   * @param {Error|any} details.lastError 
   * @param {any[]} [details.allErrors] 
   */
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

/**
 * Custom error thrown when an operation exceeds its configured timeout.
 */
export class TimeoutError extends Error {
  /**
   * @param {string} message - Error description
   * @param {number} timeoutMs - Timeout duration in milliseconds
   */
  constructor(message = 'Operation timed out', timeoutMs) {
    super(message);
    this.name = 'TimeoutError';
    this.timeoutMs = timeoutMs;

    if (Error.captureStackTrace) {
      Error.captureStackTrace(this, TimeoutError);
    }
  }
}

export class AbortError extends Error {
  /**
   *  @param {string} message
   */
  constructor(message = 'Operation was aborted') {
    super(message);
    this.name = 'AbortError';

    if (Error.captureStackTrace) {
      Error.captureStackTrace(this, AbortError);
    }
  }
}
