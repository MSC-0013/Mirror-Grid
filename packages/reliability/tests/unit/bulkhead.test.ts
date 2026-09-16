import assert from 'node:assert';
import { BulkheadCore } from '../../src/core/bulkhead.js';

function testBulkhead() {
  console.log('Testing BulkheadCore...');

  const bulkhead = new BulkheadCore({
    maxConcurrent: 2,
    maxQueueCapacity: 2,
    queueTimeoutMicros: 1_000_000n, // 1s
  });

  const now = 1_000_000n;

  // Admit 2 concurrent requests
  const r1 = bulkhead.tryAcquire(now);
  assert.strictEqual(r1.allowed, true);
  if (r1.allowed) assert.strictEqual(r1.queued, false);

  const r2 = bulkhead.tryAcquire(now);
  assert.strictEqual(r2.allowed, true);
  if (r2.allowed) assert.strictEqual(r2.queued, false);

  // 3rd request goes into queue
  const r3 = bulkhead.tryAcquire(now);
  assert.strictEqual(r3.allowed, true);
  if (r3.allowed) {
    assert.strictEqual(r3.queued, true);
    assert.strictEqual(r3.queuePosition, 1);
  }

  // 4th request goes into queue (queue full)
  const r4 = bulkhead.tryAcquire(now);
  assert.strictEqual(r4.allowed, true);
  if (r4.allowed) {
    assert.strictEqual(r4.queued, true);
    assert.strictEqual(r4.queuePosition, 2);
  }

  // 5th request rejected (bulkhead full)
  const r5 = bulkhead.tryAcquire(now);
  assert.strictEqual(r5.allowed, false);
  if (!r5.allowed) {
    assert.strictEqual(r5.reason, 'BULKHEAD_FULL');
  }

  // Release slot: promotes first queued item
  const promoted = bulkhead.release(1, now);
  assert.strictEqual(promoted, true, 'Releasing slot must promote queued item');
  assert.strictEqual(bulkhead.queuedCount, 1);

  console.log('✓ Bulkhead tests passed.');
}

testBulkhead();
