/**
 * RetryFlow - HTTP Fetch Example
 * Demonstrates HTTP status checking, exponential backoff, and request timeout.
 */
import { retry } from '../src/index.js';

// Simulated HTTP fetch function
let simulatedAttempts = 0;
async function mockFetch(url) {
  simulatedAttempts++;
  console.log(`[HTTP GET] ${url} (Attempt ${simulatedAttempts})`);

  if (simulatedAttempts === 1) {
    // Simulating 503 Service Unavailable
    return {
      status: 503,
      statusText: 'Service Unavailable',
      ok: false,
      json: async () => ({ error: 'Server temporarily overloaded' }),
    };
  }

  if (simulatedAttempts === 2) {
    // Simulating 429 Too Many Requests
    return {
      status: 429,
      statusText: 'Too Many Requests',
      ok: false,
      json: async () => ({ error: 'Rate limit exceeded' }),
    };
  }

  // Attempt 3: 200 OK
  return {
    status: 200,
    statusText: 'OK',
    ok: true,
    json: async () => ({ id: 42, title: 'Resilient API design with RetryFlow' }),
  };
}

async function main() {
  console.log('--- Example 2: API Fetch with Exponential Backoff & HTTP Status ---');

  try {
    const response = await retry(
      async () => {
        return await mockFetch('https://api.example.com/v1/posts/42');
      },
      {
        retries: 4,
        delay: 500,              // Initial 500ms
        backoff: 'exponential',  // 500ms, 1000ms, 2000ms...
        factor: 2,
        maxDelay: 5000,          // Cap delay at 5s
        timeout: 3000,           // 3s per-attempt timeout
        onRetry: ({ attempt, nextAttempt, response, delay }) => {
          console.log(
            `⚠️ Received HTTP ${response?.status} (${response?.statusText}). Retrying in ${delay}ms (attempt #${nextAttempt})...`
          );
        },
      }
    );

    const data = await response.json();
    console.log(`✅ Success (HTTP ${response.status}):`, data);
  } catch (error) {
    console.error('❌ Failed:', error);
  }
}

main();
