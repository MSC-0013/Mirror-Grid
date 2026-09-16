import assert from 'node:assert';
import { ChaosSafetyBoundary } from '../../src/faults/safety-boundary.js';

function testSafetyBoundary() {
  console.log('Testing ChaosSafetyBoundary...');

  const boundary = new ChaosSafetyBoundary({
    maxBlastRadiusPercent: 30,
    errorRateThresholdPpm: 500_000, // 50%
    burnDurationThresholdMicros: 30_000_000n, // 30s
  });

  // 1. Blast radius check: 3 degraded out of 10 = 30% -> allowed
  const b1 = boundary.checkBlastRadius(3, 10);
  assert.strictEqual(b1.allowed, true);
  assert.strictEqual(b1.blastRadiusPercent, 30);

  // 4 degraded out of 10 = 40% -> rejected (> 30%)
  const b2 = boundary.checkBlastRadius(4, 10);
  assert.strictEqual(b2.allowed, false);

  // 2. SLO burn: error rate 60% for 31s -> triggers emergency abort
  let now = 1_000_000n;
  const s1 = boundary.evaluateSafety(600_000, now);
  assert.strictEqual(s1.safe, true, 'First tick above threshold should not instantly abort');
  assert.strictEqual(s1.abortTriggered, false);

  now += 31_000_000n; // 31s later
  const s2 = boundary.evaluateSafety(600_000, now);
  assert.strictEqual(s2.safe, false);
  assert.strictEqual(s2.abortTriggered, true);
  assert.strictEqual(boundary.isAborted, true);

  console.log('✓ ChaosSafetyBoundary tests passed.');
}

testSafetyBoundary();
