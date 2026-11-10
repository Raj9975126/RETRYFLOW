import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { withTimeout, createDeadlineController } from '../src/timeout.js';
import { TimeoutError, AbortError } from '../src/errors.js';

describe('withTimeout()', () => {
  it('should resolve normally when function completes before timeout', async () => {
    const result = await withTimeout(
      async () => {
        return 'success';
      },
      { timeout: 200 }
    );

    assert.equal(result, 'success');
  });

  it('should reject with TimeoutError when function takes longer than timeout', async () => {
    await assert.rejects(
      async () => {
        await withTimeout(
          async () => {
            await new Promise((resolve) => setTimeout(resolve, 300));
            return 'should not reach';
          },
          { timeout: 50 }
        );
      },
      (err) => {
        assert.ok(err instanceof TimeoutError);
        assert.equal(err.name, 'TimeoutError');
        assert.equal(err.timeoutMs, 50);
        return true;
      }
    );
  });

  it('should reject with AbortError when signal is already aborted', async () => {
    const controller = new AbortController();
    controller.abort(new Error('Pre-aborted'));

    await assert.rejects(
      async () => {
        await withTimeout(async () => 'ok', { signal: controller.signal });
      },
      (err) => {
        assert.ok(err instanceof AbortError);
        assert.equal(err.name, 'AbortError');
        return true;
      }
    );
  });

  it('should abort during execution when external signal triggers', async () => {
    const controller = new AbortController();

    const promise = withTimeout(
      async () => {
        await new Promise((resolve) => setTimeout(resolve, 500));
        return 'completed';
      },
      { signal: controller.signal }
    );

    setTimeout(() => {
      controller.abort();
    }, 50);

    await assert.rejects(promise, (err) => {
      assert.ok(err instanceof AbortError);
      return true;
    });
  });

  it('should forward attempt number to the target function', async () => {
    let receivedAttempt = null;
    await withTimeout(
      async ({ attempt }) => {
        receivedAttempt = attempt;
        return 'done';
      },
      { attempt: 3 }
    );

    assert.equal(receivedAttempt, 3);
  });
});

describe('createDeadlineController()', () => {
  it('should calculate remaining time correctly', async () => {
    const deadline = createDeadlineController(200);
    assert.ok(deadline.getRemainingMs() <= 200);
    assert.ok(deadline.getRemainingMs() > 100);

    await new Promise((resolve) => setTimeout(resolve, 60));
    assert.ok(deadline.getRemainingMs() < 160);

    deadline.cleanup();
  });

  it('should abort signal when overall timeout expires', async () => {
    const deadline = createDeadlineController(50);
    assert.equal(deadline.signal.aborted, false);

    await new Promise((resolve) => setTimeout(resolve, 80));
    assert.equal(deadline.signal.aborted, true);
    assert.ok(deadline.isTimedOut());

    deadline.cleanup();
  });
});
