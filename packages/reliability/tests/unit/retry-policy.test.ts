import assert from 'node:assert';
import { RetryPolicyCore, RetryBudgetCore } from '../../src/core/retry-policy.js';

function testRetryPolicy() {
  console.log('Testing RetryPolicy and RetryBudgetCore...');

  const policy = new RetryPolicyCore({
    maxAttempts: 3,
    baseBackoffMicros: 100_000n, // 100ms
    maxBackoffMicros: 2_000_000n, // 2s
    backoffJitter: 'FULL',
    retryableStatusCodes: new Set([502, 503, 504]),
    budget: {
      ttlMicros: 10_000_000n, // 10s
      minRetriesPerSec: 1,
      retryRatio: 0.1, // max 10%
    },
  });

  const now = 1_000_000n;

  // 1. Non-retryable status (400, 404, 500)
  const d1 = policy.decide(1, 400, now);
  assert.strictEqual(d1.shouldRetry, false);
  if (!d1.shouldRetry) assert.strictEqual(d1.reason, 'NOT_RETRYABLE');

  // 2. Max attempts reached
  const d2 = policy.decide(3, 503, now);
  assert.strictEqual(d2.shouldRetry, false);
  if (!d2.shouldRetry) assert.strictEqual(d2.reason, 'MAX_ATTEMPTS');

  // 3. Retryable call with exponential backoff
  const d3 = policy.decide(1, 503, now, 1.0); // uniform = 1.0 -> max backoff for attempt 1
  assert.strictEqual(d3.shouldRetry, true);
  if (d3.shouldRetry) {
    assert.strictEqual(d3.backoffMicros, 100_000n);
  }

  // 4. Retry budget enforcement under 100% downstream failure
  const budget = new RetryBudgetCore({
    ttlMicros: 10_000_000n,
    minRetriesPerSec: 0,
    retryRatio: 0.1, // max 10%
  });

  // Record 100 successful initial requests
  for (let i = 0; i < 100; i++) {
    budget.recordSuccess(now, false);
  }

  // Under 10% ratio, at most 10 retries are permitted
  let retriesPermitted = 0;
  for (let i = 0; i < 20; i++) {
    if (budget.canRetry(now)) {
      budget.recordRetry(now);
      retriesPermitted++;
    }
  }

  assert.strictEqual(
    retriesPermitted,
    10,
    `Retry budget must cap retries at exactly 10% (expected 10, got ${retriesPermitted})`,
  );
  assert.strictEqual(budget.canRetry(now), false, 'Budget must be exhausted');

  console.log('✓ Retry Policy and Budget tests passed.');
}

testRetryPolicy();
