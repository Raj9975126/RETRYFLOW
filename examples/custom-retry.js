/**
 * RetryFlow - Custom Conditions and Cancellation Example
 * Demonstrates custom shouldRetry predicate, jitter, and AbortController.
 */
import { retry, AbortError } from '../src/index.js';

async function main() {
  console.log('--- Example 3: Custom shouldRetry & Cancellation ---');

  // Part A: Custom shouldRetry predicate
  console.log('\n[Part A] Retry only specific business errors');

  let paymentAttempts = 0;
  try {
    const paymentResult = await retry(
      async () => {
        paymentAttempts++;
        if (paymentAttempts === 1) {
          const err = new Error('PAYMENT_GATEWAY_TIMEOUT');
          err.code = 'GATEWAY_TIMEOUT';
          throw err;
        }
        return { paymentId: 'pay_998877', status: 'COMPLETED' };
      },
      {
        retries: 3,
        delay: 300,
        jitter: true, // Randomize delay to reduce server spike
        shouldRetry: (error) => {
          // Retry temporary gateway timeouts, but NEVER retry duplicate card charges
          if (error?.code === 'CARD_DECLINED' || error?.code === 'INSUFFICIENT_FUNDS') {
            console.log('⛔ Fatal payment error: will not retry.');
            return false;
          }
          return error?.code === 'GATEWAY_TIMEOUT';
        },
        onRetry: ({ attempt, error, delay }) => {
          console.log(`⚠️ Attempt ${attempt} failed with ${error.code}. Retrying in ${delay}ms...`);
        },
      }
    );

    console.log('✅ Payment result:', paymentResult);
  } catch (err) {
    console.error('❌ Payment failed:', err);
  }

  // Part B: Cancellation with AbortController
  console.log('\n[Part B] Manual Cancellation with AbortController');

  const controller = new AbortController();

  // Cancel after 400ms
  setTimeout(() => {
    console.log('🛑 User clicked "Cancel Request"!');
    controller.abort(new Error('User requested cancellation'));
  }, 400);

  try {
    await retry(
      async () => {
        console.log('⏳ Calling slow external vendor API...');
        await new Promise((r) => setTimeout(r, 1000));
        return 'never gets here';
      },
      {
        retries: 5,
        delay: 500,
        signal: controller.signal,
      }
    );
  } catch (err) {
    if (err instanceof AbortError) {
      console.log('✅ Gracefully stopped due to user cancellation:', err.message);
    } else {
      console.error('❌ Other error:', err);
    }
  }
}

main();
