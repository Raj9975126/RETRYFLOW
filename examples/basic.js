/**
 * RetryFlow - Basic Example
 * Demonstrates basic retry logic with fixed delay.
 */
import { retry, RetryError } from '../src/index.js';

async function simulateFlakyService(attempt) {
  console.log(`[Service] Attempt ${attempt} received...`);
  if (attempt < 3) {
    throw new Error(`Temporary database glitch (attempt ${attempt})`);
  }
  return { status: 'success', data: { id: 101, user: 'John Doe' } };
}

async function main() {
  console.log('--- Example 1: Basic Retry with Fixed Delay ---');

  try {
    const result = await retry(
      async ({ attempt }) => {
        return await simulateFlakyService(attempt);
      },
      {
        retries: 3,        // Retry up to 3 times after failure
        delay: 500,        // 500ms fixed delay between attempts
        onRetry: ({ attempt, nextAttempt, error, delay }) => {
          console.log(`⚠️ Attempt ${attempt} failed: "${error.message}". Retrying in ${delay}ms (attempt #${nextAttempt})...`);
        },
      }
    );

    console.log('✅ Final Result:', result);
  } catch (err) {
    if (err instanceof RetryError) {
      console.error('❌ All retries failed:', err.message, err.lastError);
    } else {
      console.error('❌ Unexpected error:', err);
    }
  }
}

main();
