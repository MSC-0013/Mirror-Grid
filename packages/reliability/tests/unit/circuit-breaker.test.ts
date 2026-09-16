import assert from 'node:assert';
import { CircuitBreakerCore } from '../../src/core/circuit-breaker.js';
import type { CircuitBreakerConfig } from '../../src/core/types.js';

const config: CircuitBreakerConfig = {
  failureRateThresholdPpm: 500_000, // 50%
  volumeThreshold: 10,
  sleepWindowMicros: 5_000_000n, // 5 seconds
  halfOpenMaxConcurrent: 2,
  consecutiveSuccessThreshold: 3,
  windowBucketCount: 10,
  bucketDurationMicros: 1_000_000n, // 1 second
};

function testTransitions() {
  console.log('Testing Circuit Breaker state transitions...');
  let now = 10_000_000n;
  const cb = new CircuitBreakerCore(config, now);

  assert.strictEqual(cb.state, 'CLOSED', 'Breaker must start CLOSED');

  // 1. Send 5 successes, 4 failures (9 total < volumeThreshold 10). Breaker stays CLOSED.
  for (let i = 0; i < 5; i++) {
    const adm = cb.tryAcquire(now);
    assert.strictEqual(adm.allowed, true);
    cb.recordSuccess(now);
  }
  for (let i = 0; i < 4; i++) {
    const adm = cb.tryAcquire(now);
    assert.strictEqual(adm.allowed, true);
    cb.recordFailure(now);
  }
  assert.strictEqual(cb.state, 'CLOSED', 'Breaker must stay CLOSED when volumeThreshold not met');

  // 2. 10th request fails -> total = 10, failures = 5 (50% = 500,000 ppm) -> trips to OPEN
  const adm10 = cb.tryAcquire(now);
  assert.strictEqual(adm10.allowed, true);
  const transitions = cb.recordFailure(now);
  assert.strictEqual(cb.state, 'OPEN', 'Breaker must transition to OPEN');
  assert.strictEqual(transitions.length, 1);
  assert.strictEqual(transitions[0].from, 'CLOSED');
  assert.strictEqual(transitions[0].to, 'OPEN');
  assert.strictEqual(transitions[0].reason, 'THRESHOLD_EXCEEDED');

  // 3. While OPEN before sleepWindowMicros, calls are rejected
  now += 2_000_000n; // 2s elapsed < 5s
  const rej = cb.tryAcquire(now);
  assert.strictEqual(rej.allowed, false);
  if (!rej.allowed) {
    assert.strictEqual(rej.reason, 'CIRCUIT_OPEN');
  }

  // 4. After sleepWindowMicros (5s), transitions to HALF_OPEN
  now += 3_500_000n; // Total 5.5s elapsed >= 5s
  const probe1 = cb.tryAcquire(now);
  assert.strictEqual(probe1.allowed, true, 'First probe must be allowed');
  assert.strictEqual(cb.state, 'HALF_OPEN', 'Breaker must transition to HALF_OPEN');

  const probe2 = cb.tryAcquire(now);
  assert.strictEqual(probe2.allowed, true, 'Second probe must be allowed (cap=2)');

  // 3rd probe in HALF_OPEN is rejected due to concurrency cap (2)
  const probe3 = cb.tryAcquire(now);
  assert.strictEqual(probe3.allowed, false);
  if (!probe3.allowed) {
    assert.strictEqual(probe3.reason, 'HALF_OPEN_CONCURRENCY_EXCEEDED');
  }

  // 5. Test probe failure: a single failure in HALF_OPEN re-trips to OPEN
  const tripTrans = cb.recordFailure(now);
  assert.strictEqual(cb.state, 'OPEN', 'Probe failure must re-trip breaker to OPEN');
  assert.strictEqual(tripTrans.length, 1);
  assert.strictEqual(tripTrans[0].reason, 'PROBE_FAILED');

  // 6. Advance another 5s to HALF_OPEN again
  now += 5_000_000n;
  assert.strictEqual(cb.tryAcquire(now).allowed, true);
  assert.strictEqual(cb.state, 'HALF_OPEN');

  // 7. Successful probes reach consecutiveSuccessThreshold (3) -> closes circuit
  cb.recordSuccess(now);
  assert.strictEqual(cb.state, 'HALF_OPEN');

  assert.strictEqual(cb.tryAcquire(now).allowed, true);
  cb.recordSuccess(now);
  assert.strictEqual(cb.state, 'HALF_OPEN');

  assert.strictEqual(cb.tryAcquire(now).allowed, true);
  const closeTrans = cb.recordSuccess(now);
  assert.strictEqual(cb.state, 'CLOSED', 'Trial successes must re-close breaker');
  assert.strictEqual(closeTrans.length, 1);
  assert.strictEqual(closeTrans[0].reason, 'PROBE_SUCCESS');

  // 8. Test manual overrides
  cb.trip(now, 'TEST_TRIP');
  assert.strictEqual(cb.state, 'OPEN');

  cb.reset(now);
  assert.strictEqual(cb.state, 'CLOSED');

  console.log('✓ Circuit Breaker tests passed.');
}

testTransitions();
