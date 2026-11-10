import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { calculateDelay } from '../src/backoff.js';

describe('calculateDelay()', () => {
  it('should use exponential backoff by default when option is omitted', () => {
    const delay1 = calculateDelay({ attempt: 1, delay: 1000 });
    const delay2 = calculateDelay({ attempt: 2, delay: 1000 });
    const delay3 = calculateDelay({ attempt: 3, delay: 1000 });

    assert.equal(delay1, 1000);
    assert.equal(delay2, 2000);
    assert.equal(delay3, 4000);
  });

  it('should return fixed delay when backoff: "fixed"', () => {
    const delay1 = calculateDelay({ attempt: 1, delay: 500, backoff: 'fixed' });
    const delay2 = calculateDelay({ attempt: 2, delay: 500, backoff: 'fixed' });
    const delay3 = calculateDelay({ attempt: 3, delay: 500, backoff: 'fixed' });

    assert.equal(delay1, 500);
    assert.equal(delay2, 500);
    assert.equal(delay3, 500);
  });

  it('should calculate exponential backoff delay correctly', () => {
    // Formula: delay * factor^(attempt - 1)
    const delay1 = calculateDelay({ attempt: 1, delay: 1000, backoff: 'exponential', factor: 2 });
    const delay2 = calculateDelay({ attempt: 2, delay: 1000, backoff: 'exponential', factor: 2 });
    const delay3 = calculateDelay({ attempt: 3, delay: 1000, backoff: 'exponential', factor: 2 });
    const delay4 = calculateDelay({ attempt: 4, delay: 1000, backoff: 'exponential', factor: 2 });

    assert.equal(delay1, 1000); // 1000 * 2^0
    assert.equal(delay2, 2000); // 1000 * 2^1
    assert.equal(delay3, 4000); // 1000 * 2^2
    assert.equal(delay4, 8000); // 1000 * 2^3
  });

  it('should cap calculated delay at maxDelay', () => {
    const delay = calculateDelay({
      attempt: 10,
      delay: 1000,
      backoff: 'exponential',
      factor: 2,
      maxDelay: 5000,
    });

    assert.equal(delay, 5000);
  });

  it('should support custom multiplier factor', () => {
    const delay = calculateDelay({
      attempt: 3,
      delay: 100,
      backoff: 'exponential',
      factor: 3,
    });

    // 100 * 3^2 = 900
    assert.equal(delay, 900);
  });

  it('should return randomized delay within range when jitter is enabled', () => {
    const maxDelay = 1000;
    for (let i = 0; i < 20; i++) {
      const delay = calculateDelay({
        attempt: 1,
        delay: maxDelay,
        backoff: 'fixed',
        jitter: true,
      });

      assert.ok(delay >= 0, `Delay ${delay} should be >= 0`);
      assert.ok(delay <= maxDelay, `Delay ${delay} should be <= ${maxDelay}`);
    }
  });

  it('should handle boolean true as exponential backoff', () => {
    const delay = calculateDelay({ attempt: 2, delay: 1000, backoff: true });
    assert.equal(delay, 2000);
  });
});
