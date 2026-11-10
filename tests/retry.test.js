import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { retry } from '../src/retry.js';
import { RetryError, TimeoutError, AbortError } from '../src/errors.js';

describe('retry() - Core Functionality', () => {
  it('should succeed on the first attempt without retrying', async () => {
    let callCount = 0;
    const result = await retry(async () => {
      callCount++;
      return 'success';
    });

    assert.equal(result, 'success');
    assert.equal(callCount, 1);
  });

  it('should support synchronous functions', async () => {
    let callCount = 0;
    const result = await retry(() => {
      callCount++;
      return 42;
    });

    assert.equal(result, 42);
    assert.equal(callCount, 1);
  });

  it('should throw TypeError if first argument is not a function', async () => {
    await assert.rejects(
      async () => retry(null),
      (err) => err instanceof TypeError
    );
  });

  it('should retry on failure and succeed when an attempt succeeds', async () => {
    let callCount = 0;
    const result = await retry(
      async () => {
        callCount++;
        if (callCount < 3) {
          throw new Error(`Failure on attempt ${callCount}`);
        }
        return 'recovered';
      },
      { retries: 3, delay: 10 }
    );

    assert.equal(result, 'recovered');
    assert.equal(callCount, 3);
  });

  it('should fail all attempts and throw RetryError with metadata', async () => {
    let callCount = 0;

    await assert.rejects(
      async () => {
        await retry(
          async () => {
            callCount++;
            throw new Error(`Failed attempt ${callCount}`);
          },
          { retries: 2, delay: 10 }
        );
      },
      (err) => {
        assert.ok(err instanceof RetryError);
        assert.equal(err.name, 'RetryError');
        assert.equal(err.attempts, 3); // 1 initial + 2 retries
        assert.equal(err.lastError.message, 'Failed attempt 3');
        assert.equal(err.allErrors.length, 3);
        return true;
      }
    );

    assert.equal(callCount, 3);
  });

  it('should throw immediately without retrying if retries is 0', async () => {
    let callCount = 0;

    await assert.rejects(
      async () => {
        await retry(
          async () => {
            callCount++;
            throw new Error('Immediate failure');
          },
          { retries: 0 }
        );
      },
      (err) => {
        assert.equal(err.message, 'Immediate failure');
        return true;
      }
    );

    assert.equal(callCount, 1);
  });
});

describe('retry() - Advanced Features', () => {
  it('should invoke onRetry callback before each retry attempt', async () => {
    const logs = [];
    let callCount = 0;

    const result = await retry(
      async () => {
        callCount++;
        if (callCount < 3) {
          throw new Error('Temporary failure');
        }
        return 'done';
      },
      {
        retries: 3,
        delay: 15,
        onRetry: ({ attempt, nextAttempt, error, delay }) => {
          logs.push({ attempt, nextAttempt, msg: error.message, delay });
        },
      }
    );

    assert.equal(result, 'done');
    assert.equal(logs.length, 2);
    assert.equal(logs[0].attempt, 1);
    assert.equal(logs[0].nextAttempt, 2);
    assert.equal(logs[0].delay, 15);
    assert.equal(logs[1].attempt, 2);
    assert.equal(logs[1].nextAttempt, 3);
  });

  it('should handle exponential backoff delays', async () => {
    const delays = [];
    let callCount = 0;

    await assert.rejects(
      async () => {
        await retry(
          async () => {
            callCount++;
            throw new Error('fail');
          },
          {
            retries: 3,
            delay: 10,
            backoff: 'exponential',
            factor: 2,
            onRetry: ({ delay }) => delays.push(delay),
          }
        );
      }
    );

    // attempt 1 retry delay: 10 * 2^0 = 10
    // attempt 2 retry delay: 10 * 2^1 = 20
    // attempt 3 retry delay: 10 * 2^2 = 40
    assert.deepEqual(delays, [10, 20, 40]);
  });

  it('should retry HTTP 500 status code on error object', async () => {
    let attempts = 0;

    const result = await retry(
      async () => {
        attempts++;
        if (attempts === 1) {
          const err = new Error('Internal Server Error');
          err.status = 500;
          throw err;
        }
        return 'success on retry';
      },
      { retries: 2, delay: 10 }
    );

    assert.equal(result, 'success on retry');
    assert.equal(attempts, 2);
  });

  it('should not retry HTTP 404 client errors by default', async () => {
    let attempts = 0;

    await assert.rejects(
      async () => {
        await retry(
          async () => {
            attempts++;
            const notFound = new Error('Not Found');
            notFound.status = 404;
            throw notFound;
          },
          { retries: 3, delay: 10 }
        );
      },
      (err) => {
        assert.equal(err.status, 404);
        return true;
      }
    );

    // Should stop immediately after attempt 1
    assert.equal(attempts, 1);
  });

  it('should inspect resolved fetch-like Response objects with .status', async () => {
    let attempts = 0;
    const response = await retry(
      async () => {
        attempts++;
        if (attempts === 1) {
          return { status: 503, ok: false, data: null };
        }
        return { status: 200, ok: true, data: { user: 'Alice' } };
      },
      { retries: 2, delay: 10 }
    );

    assert.equal(response.status, 200);
    assert.equal(response.data.user, 'Alice');
    assert.equal(attempts, 2);
  });

  it('should support custom shouldRetry condition', async () => {
    let attempts = 0;

    const result = await retry(
      async () => {
        attempts++;
        if (attempts === 1) {
          throw new Error('RATE_LIMIT_EXCEEDED');
        }
        return 'ok';
      },
      {
        retries: 2,
        delay: 10,
        shouldRetry: (error) => error?.message === 'RATE_LIMIT_EXCEEDED',
      }
    );

    assert.equal(result, 'ok');
    assert.equal(attempts, 2);
  });

  it('should not retry when custom shouldRetry returns false', async () => {
    let attempts = 0;

    await assert.rejects(
      async () => {
        await retry(
          async () => {
            attempts++;
            throw new Error('VALIDATION_ERROR');
          },
          {
            retries: 3,
            delay: 10,
            shouldRetry: (error) => error?.message === 'RATE_LIMIT_EXCEEDED',
          }
        );
      },
      (err) => err.message === 'VALIDATION_ERROR'
    );

    assert.equal(attempts, 1);
  });

  it('should timeout individual attempts and retry them', async () => {
    let attempts = 0;

    const result = await retry(
      async () => {
        attempts++;
        if (attempts === 1) {
          await new Promise((resolve) => setTimeout(resolve, 80));
          return 'slow';
        }
        return 'fast';
      },
      {
        retries: 2,
        delay: 10,
        timeout: 30,
      }
    );

    assert.equal(result, 'fast');
    assert.equal(attempts, 2);
  });

  it('should cancel retries immediately when AbortController signals', async () => {
    const controller = new AbortController();
    let attempts = 0;

    const retryPromise = retry(
      async () => {
        attempts++;
        throw new Error('Transient error');
      },
      {
        retries: 5,
        delay: 50,
        signal: controller.signal,
      }
    );
    setTimeout(() => {
      controller.abort(new Error('User cancelled'));
    }, 20);

    await assert.rejects(
      retryPromise,
      (err) => {
        assert.ok(err instanceof AbortError);
        return true;
      }
    );

    // Should not have performed all 6 attempts
    assert.ok(attempts < 5, `Attempts should be aborted, but was ${attempts}`);
  });

  it('should enforce overallTimeout across all attempts and sleep delays', async () => {
    const startTime = Date.now();
    let attempts = 0;

    await assert.rejects(
      async () => {
        await retry(
          async () => {
            attempts++;
            // Each attempt is slow (50ms)
            await new Promise((resolve) => setTimeout(resolve, 50));
            throw new Error('Temporary failure');
          },
          {
            retries: 10,
            delay: 40,
            overallTimeout: 120, // Total deadline: 120ms
          }
        );
      },
      (err) => {
        assert.ok(err instanceof TimeoutError);
        assert.ok(err.message.includes('Total retry operation timed out'));
        return true;
      }
    );

    const elapsed = Date.now() - startTime;
    // Total execution should be bounded near 120ms (with small margin), definitely not 10 * 90ms = 900ms
    assert.ok(elapsed < 250, `Elapsed time ${elapsed}ms exceeded overall deadline`);
    assert.ok(attempts < 5, `Should have aborted early, attempts made: ${attempts}`);
  });

  it('should not retry on timeout when retryOnTimeout is false', async () => {
    let attempts = 0;

    await assert.rejects(
      async () => {
        await retry(
          async () => {
            attempts++;
            await new Promise((resolve) => setTimeout(resolve, 80));
            return 'done';
          },
          {
            retries: 3,
            delay: 10,
            timeout: 25, // 25ms per attempt
            retryOnTimeout: false,
          }
        );
      },
      (err) => {
        assert.ok(err instanceof TimeoutError);
        return true;
      }
    );

    assert.equal(attempts, 1);
  });
});
