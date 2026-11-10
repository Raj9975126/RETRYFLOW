/**
 * Calculates the delay in milliseconds before the next retry attempt.
 *
 * @param {Object} options
 * @param {number} options.attempt - The current retry attempt index (1-based: 1 for first retry)
 * @param {number} [options.delay=1000] - Base delay in milliseconds
 * @param {string|boolean} [options.backoff='exponential'] - 'exponential' | 'fixed' (or true/false)
 * @param {number} [options.factor=2] - Multiplier factor for exponential backoff
 * @param {number} [options.maxDelay=30000] - Maximum cap on delay in milliseconds
 * @param {boolean} [options.jitter=false] - Whether to randomize delay to avoid thundering herds
 * @returns {number} The delay in milliseconds
 */
export function calculateDelay({
  attempt = 1,
  delay = 1000,
  backoff = 'exponential',
  factor = 2,
  maxDelay = 30000,
  jitter = false,
} = {}) {
  // Ensure non-negative safe inputs
  const safeAttempt = Math.max(1, attempt);
  const baseDelay = Math.max(0, delay);
  const safeMax = Math.max(0, maxDelay);

  const isExponential = backoff !== 'fixed' && backoff !== false;

  let computedDelay = baseDelay;

  if (isExponential) {
    computedDelay = baseDelay * Math.pow(factor, safeAttempt - 1);
  }
  computedDelay = Math.min(computedDelay, safeMax);
  
  // Apply jitter if enabled (Full Jitter: random value between 0 and computedDelay)
  if (jitter) {
    computedDelay = Math.floor(Math.random() * (computedDelay + 1));
  }

  return Math.round(computedDelay);
}
