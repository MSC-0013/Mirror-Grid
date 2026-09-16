import assert from 'node:assert';
import { SlidingWindowDetectorEngine } from '../../src/detectors/detector-engine.js';
import type { DetectorSpec } from '../../src/engine/freeze.js';
import type { MetricSample } from '../../src/detectors/detector-rules.js';

async function testDetectorEngine() {
  console.log('Testing SlidingWindowDetectorEngine & MTTD/MTTR...');

  const engine = new SlidingWindowDetectorEngine(2_000_000n); // 2s debounce

  const errorDetector: DetectorSpec = {
    id: 'det-orders-error',
    name: 'Orders Error Rate',
    type: 'ERROR_RATE',
    targetServiceId: 'orders',
    threshold: 50,
    windowMicros: 2_000_000n,
  };

  engine.registerDetector(errorDetector);

  // T=0s: Normal baseline (0% error)
  const baselineSample: MetricSample = {
    nowMicros: 0n,
    services: [
      {
        serviceId: 'orders',
        requestsTotal: 100,
        requestsFailed: 0,
        latencyP50Us: 10_000n,
        latencyP95Us: 15_000n,
        latencyP99Us: 20_000n,
        queueDepth: 0,
        queueCapacity: 200,
        activeSlots: 5,
        concurrencyLimit: 64,
      },
    ],
  };

  let evals = engine.evaluateMetrics(baselineSample);
  assert.strictEqual(evals[0].isTriggered, false, 'Baseline should not trigger detector');

  // T=10s: Fault injected
  engine.onFaultInjected('payments-latency', 10_000_000n);

  // T=12s: Error rate jumps to 60%
  const failureSample: MetricSample = {
    nowMicros: 12_000_000n,
    services: [
      {
        serviceId: 'orders',
        requestsTotal: 100,
        requestsFailed: 60,
        latencyP50Us: 400_000n,
        latencyP95Us: 450_000n,
        latencyP99Us: 500_000n,
        queueDepth: 50,
        queueCapacity: 200,
        activeSlots: 64,
        concurrencyLimit: 64,
      },
    ],
  };

  evals = engine.evaluateMetrics(failureSample);
  assert.strictEqual(evals[0].isTriggered, true, 'Error rate 60% should trigger detector');

  // T=25s: Fault cleared
  engine.onFaultCleared('payments-latency', 25_000_000n);

  // T=30s: System recovers (0% error)
  const recoveredSample: MetricSample = {
    nowMicros: 30_000_000n,
    services: [
      {
        serviceId: 'orders',
        requestsTotal: 100,
        requestsFailed: 0,
        latencyP50Us: 10_000n,
        latencyP95Us: 15_000n,
        latencyP99Us: 20_000n,
        queueDepth: 0,
        queueCapacity: 200,
        activeSlots: 5,
        concurrencyLimit: 64,
      },
    ],
  };

  engine.evaluateMetrics(recoveredSample);

  // T=33s: After 3s healthy (satisfying 2s debounce)
  const stableSample: MetricSample = {
    nowMicros: 33_000_000n,
    services: recoveredSample.services,
  };

  engine.evaluateMetrics(stableSample);

  const results = engine.computeResults();
  // MTTD = 12s - 10s = 2s = 2_000_000µs
  assert.strictEqual(results.mttdMicros, 2_000_000n, 'MTTD should be exactly 2.0s (2,000,000µs)');
  // MTTR = 30s - 25s = 5s = 5_000_000µs
  assert.strictEqual(results.mttrMicros, 5_000_000n, 'MTTR should be exactly 5.0s (5,000,000µs)');

  console.log('✓ SlidingWindowDetectorEngine & MTTD/MTTR tests passed cleanly');
}

testDetectorEngine().catch((err) => {
  console.error(err);
  process.exit(1);
});
