import assert from 'node:assert';
import { RcaEngine, type GraphNode, type GraphEdge, type NodeMetrics } from '../../src/index.js';

console.log('--- Testing Graph-Theoretic Automated RCA Engine ---');

const nodes: GraphNode[] = [
  { id: 'gw', name: 'Gateway' },
  { id: 'orders', name: 'Orders' },
  { id: 'inventory', name: 'Inventory' },
  { id: 'payments', name: 'Payments' },
  { id: 'db', name: 'Database' },
];

const edges: GraphEdge[] = [
  { sourceId: 'gw', targetId: 'orders' },
  { sourceId: 'orders', targetId: 'inventory' },
  { sourceId: 'inventory', targetId: 'payments' },
  { sourceId: 'payments', targetId: 'db' },
];

// Cascade scenario:
// Payments experiences latency surge of +400ms at T0 = 1000
// Upstream queues back up:
// Inventory backs up at T = 1200
// Orders backs up at T = 1500
// Gateway times out (504) at T = 1800
// DB is completely healthy (2ms latency, 0 errors)
const metrics: NodeMetrics[] = [
  {
    serviceId: 'gw',
    serviceName: 'Gateway',
    isDegraded: true,
    firstAnomalyTimestampMicros: 1800,
    totalLatencyMicros: 425_000,
    selfLatencyMicros: 5_000,
    errorCount: 150, // 504 errors
    requestCount: 1000,
    metricType: '504_GATEWAY_TIMEOUT',
    deviationFactor: 8.5,
  },
  {
    serviceId: 'orders',
    serviceName: 'Orders',
    isDegraded: true,
    firstAnomalyTimestampMicros: 1500,
    totalLatencyMicros: 420_000,
    selfLatencyMicros: 10_000,
    errorCount: 80,
    requestCount: 1000,
    metricType: 'THREAD_POOL_EXHAUSTION',
    deviationFactor: 6.2,
  },
  {
    serviceId: 'inventory',
    serviceName: 'Inventory',
    isDegraded: true,
    firstAnomalyTimestampMicros: 1200,
    totalLatencyMicros: 410_000,
    selfLatencyMicros: 8_000,
    errorCount: 20,
    requestCount: 1000,
    metricType: 'UPSTREAM_WAIT_SATURATION',
    deviationFactor: 4.8,
  },
  {
    serviceId: 'payments',
    serviceName: 'Payments',
    isDegraded: true,
    firstAnomalyTimestampMicros: 1000, // EARLIEST (Origin)
    totalLatencyMicros: 402_000,
    selfLatencyMicros: 400_000, // HIGH INTERNAL LATENCY
    errorCount: 5,
    requestCount: 1000,
    metricType: 'LATENCY_SPIKE',
    deviationFactor: 12.4,
  },
  {
    serviceId: 'db',
    serviceName: 'Database',
    isDegraded: false, // HEALTHY
    firstAnomalyTimestampMicros: 0,
    totalLatencyMicros: 2_000,
    selfLatencyMicros: 2_000,
    errorCount: 0,
    requestCount: 1000,
    metricType: 'NORMAL',
    deviationFactor: 1.0,
  },
];

const rcaResult = RcaEngine.analyze({ nodes, edges, metrics });

console.log('RCA Analysis Result:', {
  rootCause: rcaResult.rootCauseServiceName,
  confidence: `${rcaResult.confidencePercentage}%`,
  failureType: rcaResult.failureType,
  causalPath: rcaResult.causalPath.map((p) => p.serviceName).join(' -> '),
});

// Assertions:
// 1. Must designate Payments, NOT Gateway (which has the highest error count)
assert.strictEqual(
  rcaResult.rootCauseServiceId,
  'payments',
  `Root cause must be payments (got ${rcaResult.rootCauseServiceId})`,
);
assert.strictEqual(
  rcaResult.rootCauseServiceName,
  'Payments',
  `Root cause name must be Payments`,
);

// 2. Confidence must be >= 90%
assert.ok(
  rcaResult.confidencePercentage >= 90.0,
  `Confidence percentage must be >= 90% (got ${rcaResult.confidencePercentage}%)`,
);

// 3. Failure type must be LATENCY_INDUCED_SATURATION
assert.strictEqual(rcaResult.failureType, 'LATENCY_INDUCED_SATURATION');

// 4. Causal path must trace Gateway -> Orders -> Inventory -> Payments
const pathNames = rcaResult.causalPath.map((p) => p.serviceName);
assert.deepStrictEqual(pathNames, ['Gateway', 'Orders', 'Inventory', 'Payments']);

// 5. Must provide architectural recommendation
assert.ok(
  rcaResult.architecturalRecommendation.toLowerCase().includes('circuit breaker') ||
    rcaResult.architecturalRecommendation.toLowerCase().includes('timeout'),
  'Recommendation must mention circuit breaker or timeout',
);

console.log('✓ Assertion passed: Graph RCA correctly isolates Payments with >90% confidence!');
console.log('All RCA Unit Tests Passed!\n');
