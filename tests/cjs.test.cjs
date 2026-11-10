const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const retry = require('../src/index.cjs');
const { calculateDelay, withTimeout, RetryError } = require('../src/index.cjs');

describe('CommonJS compatibility', () => {
  it('should import and execute retry via require()', async () => {
    let runs = 0;
    const result = await retry(async () => {
      runs++;
      if (runs < 2) throw new Error('CJS temporary err');
      return 'cjs works';
    }, { retries: 2, delay: 5 });

    assert.equal(result, 'cjs works');
    assert.equal(runs, 2);
  });

  it('should export helper functions in CommonJS', () => {
    assert.equal(typeof calculateDelay, 'function');
    assert.equal(typeof withTimeout, 'function');
    assert.equal(typeof RetryError, 'function');
  });
});
