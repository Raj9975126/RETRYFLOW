# RetryFlow

> A lightweight, zero-dependency retry engine for JavaScript & Node.js featuring exponential backoff, HTTP status filtering, per-attempt timeouts, and cancellation.

---

## Highlights

- **Zero External Dependencies**: Pure standard JavaScript; runs on Node.js 18+.
- **Dual Support**: Works out of the box with ES Modules (`import`) and CommonJS (`require`).
- **Fetch Friendly**: Inspects both rejected errors and resolved responses (such as HTTP `429`, `500`, `502`, `503`, `504`).
- **Backoff & Jitter**: Fixed delay or exponential backoff with configurable factors, limits, and full jitter.
- **Timeout & Abort**: Native `AbortController` cancellation and per-attempt timeout support.
- **Custom Predicates**: Full control over what constitutes a retryable operation.

---

## Installation

```bash
npm install retryflow
```

---

## Quick Start

### 1. Basic Retry

```javascript
import { retry } from 'retryflow';

const data = await retry(
  async ({ attempt }) => {
    return await fetchUserData(attempt);
  },
  {
    retries: 3, // up to 3 retries after failure
    delay: 1000 // 1-second fixed delay
  }
);
```

### 2. HTTP Fetch with Exponential Backoff

```javascript
import { retry } from 'retryflow';

const response = await retry(
  () => fetch('https://api.example.com/data'),
  {
    retries: 4,
    delay: 500,             // starting delay 500ms
    backoff: 'exponential', // 500ms -> 1000ms -> 2000ms -> 4000ms
    maxDelay: 10000,        // cap delay at 10 seconds
    timeout: 3000,          // 3-second timeout per attempt
    onRetry: ({ attempt, nextAttempt, delay, response }) => {
      console.warn(`Attempt ${attempt} returned ${response?.status}. Next attempt (#${nextAttempt}) in ${delay}ms`);
    }
  }
);
```

### 3. Custom Retry Logic & Cancellation

```javascript
import { retry, AbortError } from 'retryflow';

const controller = new AbortController();

try {
  const result = await retry(
    async () => performTransfer(),
    {
      retries: 3,
      delay: 500,
      jitter: true,
      signal: controller.signal,
      shouldRetry: (error, response) => {
        // Never retry card decline or authentication errors
        if (error?.code === 'CARD_DECLINED' || error?.status === 401) {
          return false;
        }
        return error?.code === 'GATEWAY_TIMEOUT';
      }
    }
  );
} catch (err) {
  if (err instanceof AbortError) {
    console.log('Transfer cancelled by user');
  }
}
```

---

## API Reference

### `retry(fn, options)`

Executes `fn` and retries it upon failure according to `options`.

#### Parameters:
- `fn`: `({ attempt, signal }) => Promise<any> | any`
- `options`:
  | Option | Type | Default | Description |
  |---|---|---|---|
  | `retries` | `number` | `3` | Maximum retry attempts after initial failure |
  | `delay` | `number` | `1000` | Base delay between retries in milliseconds |
  | `backoff` | `string` \| `boolean` | `'fixed'` | `'fixed'` or `'exponential'` |
  | `factor` | `number` | `2` | Multiplier for exponential backoff |
  | `maxDelay` | `number` | `30000` | Upper limit for delay in milliseconds |
  | `jitter` | `boolean` | `false` | Randomize delay to reduce server load |
  | `timeout` | `number` | `0` | Per-attempt timeout in ms (`0` disables timeout) |
  | `overallTimeout` | `number` | `0` | Total deadline timeout in ms across all attempts & delays (`0` disables) |
  | `retryOnTimeout` | `boolean` | `true` | Whether to retry when an attempt times out |
  | `signal` | `AbortSignal` | `undefined` | AbortSignal to cancel retries |
  | `retryStatusCodes` | `number[]` | `[408, 429, 500, 502, 503, 504]` | HTTP status codes eligible for retry |
  | `shouldRetry` | `Function` | `undefined` | Predicate `(error, response, context) => boolean` |
  | `onRetry` | `Function` | `undefined` | Callback `({ attempt, nextAttempt, error, response, delay }) => void` |
  | `throwOnFailedResponse`| `boolean` | `false` | Throws `RetryError` when response status exhausts retries |

---

## Error Types

RetryFlow exports specific error classes:

- **`RetryError`**: Thrown when all retry attempts fail. Contains:
  - `attempts`: Total number of attempts executed.
  - `lastError`: The final error or unhandled response.
  - `allErrors`: Array of errors accumulated across all attempts.
- **`TimeoutError`**: Thrown when an individual execution attempt exceeds `timeout`.
- **`AbortError`**: Thrown when the caller aborts via `AbortSignal`.

---

## Running Tests

RetryFlow uses the native Node.js test runner:

```bash
npm test
```

Run bundled examples:

```bash
npm run example:basic
npm run example:fetch
npm run example:custom
```

---

## License

[MIT](LICENSE)
