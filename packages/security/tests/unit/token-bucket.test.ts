import assert from 'node:assert';
import { RateLimiter } from '../../src/ratelimit/limiter.js';

export async function testRateLimiter() {
  console.log('Testing Token Bucket Rate Limiter with Adaptive Penalty...');

  const limiter = new RateLimiter({
    capacity: 10,
    refillRatePerSec: 2,
    adaptive: true,
  });

  const ip = '192.168.1.50';
  const now = 1000000;

  // Consume 10 allowed tokens
  for (let i = 0; i < 10; i++) {
    const res = limiter.checkLimit(ip, 1, now);
    assert.strictEqual(res.allowed, true, `Request #${i + 1} within capacity must be allowed`);
    assert.strictEqual(res.limit, 10);
  }

  // 11th request must be rejected (capacity exhausted)
  const rejected = limiter.checkLimit(ip, 1, now);
  assert.strictEqual(rejected.allowed, false, '11th request must be rejected');
  assert.strictEqual(rejected.remaining, 0);
  assert(rejected.retryAfterSeconds > 0, 'retryAfterSeconds must be > 0');
  console.log('✓ Burst limit strictly enforced with RFC 6585 attributes.');

  // Test adaptive penalty escalation
  const badClient = '10.0.0.99';
  for (let i = 0; i < 5; i++) {
    limiter.recordClientError(badClient, now + i * 1000);
  }

  // After 5 client errors, badClient should have penalty applied
  const penalized = limiter.checkLimit(badClient, 1, now + 6000);
  assert.strictEqual(penalized.penalized, true, 'Client with >= 5 errors must be marked penalized');
  console.log('✓ Adaptive penalty escalation verified on repeated client errors.');
}
