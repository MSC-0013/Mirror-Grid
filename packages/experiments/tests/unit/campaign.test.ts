import assert from 'node:assert';
import {
  LoadRunner,
  HeapLeakDetector,
  CampaignExecutor,
  CampaignReportGenerator,
} from '../../src/campaign/index.js';

console.log('--- Testing Campaign Engine, Load Runner, & Leak Detector ---');

// 1. High-throughput LoadRunner Benchmark
console.log('[1/4] Running 10,000 request in-process load test...');
const loadResult = await LoadRunner.execute(
  {
    targetRps: 10000,
    totalRequests: 10000,
    concurrency: 500,
  },
  async () => true,
);

assert.strictEqual(loadResult.totalRequests, 10000);
assert.strictEqual(loadResult.successfulRequests, 10000);
assert.strictEqual(loadResult.failedRequests, 0);
assert.ok(
  loadResult.actualRps >= 10000,
  `LoadRunner must sustain >= 10,000 req/s, achieved: ${loadResult.actualRps} req/s`,
);
assert.ok(
  loadResult.latencies.p99Ms <= 5.0,
  `P99 latency must be <= 5.0ms, measured: ${loadResult.latencies.p99Ms}ms`,
);
console.log(
  `✓ LoadRunner achieved ${loadResult.actualRps} req/s with P99 = ${loadResult.latencies.p99Ms}ms`,
);

// 2. V8 Heap Memory Leak Detector
console.log('[2/4] Testing V8 heap leak detection across 20,000 allocations...');
const heapResult = await HeapLeakDetector.profile(
  async () => {
    const list: unknown[] = [];
    for (let i = 0; i < 20000; i++) {
      list.push({ index: i, text: 'transient-buffer-data' });
    }
    list.length = 0; // release references
  },
  { thresholdBytes: 10 * 1024 * 1024 },
);

assert.strictEqual(heapResult.isLeakDetected, false, 'No memory leak should be detected');
assert.ok(
  heapResult.deltaBytes <= 10 * 1024 * 1024,
  `Heap delta must be <= 10MB, measured: ${(heapResult.deltaBytes / (1024 * 1024)).toFixed(2)}MB`,
);
console.log(
  `✓ HeapLeakDetector certified heap delta ${(heapResult.deltaBytes / (1024 * 1024)).toFixed(2)}MB <= 10MB threshold`,
);

// 3. 20-Scenario Chaos Campaign Suite
console.log('[3/4] Executing 20-Scenario Chaos Campaign Suite...');
const campaignResult = await CampaignExecutor.run20Scenarios({
  worldId: 'world-unit-test-campaign',
});

assert.strictEqual(campaignResult.totalScenarios, 20);
assert.strictEqual(campaignResult.passedScenarios, 20);
assert.strictEqual(campaignResult.failedScenarios, 0);
assert.strictEqual(campaignResult.status, 'COMPLETED');
assert.ok(campaignResult.totalThroughputRps >= 1000);
assert.ok(campaignResult.p99LatencyMs <= 5.0);
console.log(
  `✓ 20-Scenario Campaign completed with 20/20 PASSED (Throughput: ${campaignResult.totalThroughputRps} req/s)`,
);

// 4. Executive Markdown Report Generator
console.log('[4/4] Generating Executive Markdown Certification Report...');
const markdown = CampaignReportGenerator.generateMarkdown(campaignResult);

assert.ok(markdown.includes('CERTIFIED PRODUCTION READY (GA v1.0)'));
assert.ok(markdown.includes('20 / 20 required (100%)'));
assert.ok(markdown.includes('Execution Matrix'));
assert.ok(markdown.includes('HTTP 500 Surge'));
assert.ok(markdown.includes('Full Disaster Recovery Cold Restore'));
console.log('✓ Executive report successfully generated with formal GA certification statement');

console.log('\nAll Campaign Unit Tests Passed Cleanly!\n');
