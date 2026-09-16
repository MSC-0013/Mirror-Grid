import assert from 'node:assert';
import { TokenBucketCore } from '../../src/core/token-bucket.js';

function testTokenBucket() {
  console.log('Testing TokenBucketCore...');

  const tb = new TokenBucketCore(
    {
      capacity: 10,
      refillRatePerSec: 5,
    },
    0n,
  );

  assert.strictEqual(tb.availableTokens(0n), 10);
  assert.strictEqual(tb.tryConsume(6, 0n), true);
  assert.strictEqual(tb.availableTokens(0n), 4);

  // Exceed remaining
  assert.strictEqual(tb.tryConsume(5, 0n), false);

  // Advance 1 second -> refills 5 tokens -> total becomes 9
  assert.strictEqual(tb.availableTokens(1_000_000n), 9);
  assert.strictEqual(tb.tryConsume(9, 1_000_000n), true);

  console.log('✓ TokenBucket tests passed.');
}

testTokenBucket();
