import assert from 'node:assert/strict';
import { HdrHistogram } from '../../src/metrics/histogram.js';

export async function testHistogram() {
  console.log('Testing HdrHistogram...');

  const hist = new HdrHistogram();

  // Record 100 uniform samples from 1 to 100
  for (let i = 1; i <= 100; i++) {
    hist.record(i);
  }

  assert.equal(hist.getCount(), 100);
  assert.equal(hist.getMin(), 1);
  assert.equal(hist.getMax(), 100);
  assert.equal(hist.getSum(), 5050);

  const percentiles = hist.getPercentiles();
  // P50 of 1..100 should be approx 50.5
  assert.ok(Math.abs(percentiles.p50 - 50.5) <= 1.0, `P50 expected ~50.5, got ${percentiles.p50}`);
  // P99 of 1..100 should be approx 99
  assert.ok(Math.abs(percentiles.p99 - 99.0) <= 1.0, `P99 expected ~99.0, got ${percentiles.p99}`);

  console.log('✓ HdrHistogram tests passed');
}
