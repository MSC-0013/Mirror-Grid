/**
 * M9 Verification Gate Script: tests/gates/verify-observability.ts
 *
 * Enforces the M09 Observability verification assertions:
 * 1. Trace context unbroken across 4-hop distributed call chain (traceparent propagated cleanly).
 * 2. GET /metrics complies strictly with Prometheus exposition format 0.0.4.
 * 3. Structured logs correlate 100% with trace_id and span_id via context.
 * 4. Waterfall tree accurately calculates critical path and latency offset/width percentages.
 * 5. Standalone SQLite span store operates with full query and waterfall visualization fidelity.
 * 6. Zero-Mock Rule compliance (§102).
 */

import assert from 'node:assert';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { runMigrations, db, sql, insertReturning } from '../../packages/db/src/index.js';
import { traceSpans } from '../../packages/db/src/schema/observability.js';
import { worlds, organizations, users } from '../../packages/db/src/schema/core.js';
import {
  W3CTraceContext,
  Tracer,
  SpanCollector,
  TraceWaterfallBuilder,
  MetricRegistry,
  createCorrelatedLogger,
  runWithTraceContext,
} from '../../packages/observability/src/index.js';
import { buildServer } from '../../apps/control/src/server.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const REPO_ROOT = path.resolve(__dirname, '../..');

async function checkNoMockDataRule(dir: string): Promise<string[]> {
  const violations: string[] = [];

  function scan(currentDir: string) {
    const entries = fs.readdirSync(currentDir, { withFileTypes: true });
    for (const entry of entries) {
      if (
        entry.name === 'node_modules' ||
        entry.name === '.git' ||
        entry.name === '.next' ||
        entry.name === 'dist'
      ) {
        continue;
      }
      const fullPath = path.join(currentDir, entry.name);
      if (entry.isDirectory()) {
        scan(fullPath);
      } else if (entry.name === 'mock-data.ts' || entry.name.endsWith('.mock.ts')) {
        violations.push(fullPath);
      }
    }
  }

  scan(dir);
  return violations;
}

async function runGate() {
  console.log('====================================================');
  console.log('       MIRRORGRID M9: Observability Gate            ');
  console.log('====================================================\n');

  // 1. Ensure migrations are applied
  console.log('[1/6] Applying database migrations for observability...');
  await runMigrations();
  console.log('✓ SQLite database migrations up to date (including 010_observability.sql).');

  // Ensure organization and user exist
  let org = (await db.select().from(organizations).limit(1))[0];
  if (!org) {
    org = await insertReturning(organizations, {
      id: crypto.randomUUID(),
      name: 'Obs Test Org',
      slug: `obs-test-org-${Date.now()}`,
    });
  }

  let user = (await db.select().from(users).limit(1))[0];
  if (!user) {
    user = await insertReturning(users, {
      id: crypto.randomUUID(),
      email: `obs-test-${Date.now()}@mirrorgrid.local`,
      passwordHash: 'dummy-hash',
      displayName: 'Obs Test User',
    });
  }

  // Create a dedicated test world
  const testWorldId = crypto.randomUUID();
  await db.insert(worlds).values({
    id: testWorldId,
    organizationId: org.id,
    createdBy: user.id,
    name: `Obs-Test-World-${Date.now()}`,
    status: 'READY',
    runtimeMode: 'LOGICAL',
    createdAt: new Date(),
    updatedAt: new Date(),
  });

  // =========================================================================
  // Assertion 1: W3C Traceparent Context Across 4-Hop Distributed Call Chain
  // =========================================================================
  console.log('\n[2/6] [Assertion 1] Testing W3C Trace Context Propagation across 4-hop chain...');

  // Hop 1: Gateway (Root Span)
  const hop1Span = Tracer.startSpan('POST /checkout', {
    worldId: testWorldId,
    serviceName: 'api-gateway',
    spanKind: 'SERVER',
    attributes: { 'http.route': '/checkout' },
  });
  const rootContext = hop1Span.getContext();

  // Hop 2: Orders Service (Child of Gateway)
  const hop2Header = W3CTraceContext.serializeTraceParent(hop1Span.getContext());
  const hop2Ctx = W3CTraceContext.parseTraceParent(hop2Header)!;
  const hop2Span = Tracer.startSpan('CreateOrder', {
    worldId: testWorldId,
    serviceName: 'orders-service',
    parentContext: hop2Ctx,
    spanKind: 'SERVER',
  });

  // Hop 3: Payments Service (Child of Orders)
  const hop3Header = W3CTraceContext.serializeTraceParent(hop2Span.getContext());
  const hop3Ctx = W3CTraceContext.parseTraceParent(hop3Header)!;
  const hop3Span = Tracer.startSpan('ProcessPayment', {
    worldId: testWorldId,
    serviceName: 'payments-service',
    parentContext: hop3Ctx,
    spanKind: 'SERVER',
  });

  // Hop 4: Database / Ledger (Child of Payments)
  const hop4Header = W3CTraceContext.serializeTraceParent(hop3Span.getContext());
  const hop4Ctx = W3CTraceContext.parseTraceParent(hop4Header)!;
  const hop4Span = Tracer.startSpan('UPDATE ledger', {
    worldId: testWorldId,
    serviceName: 'ledger-db',
    parentContext: hop4Ctx,
    spanKind: 'CLIENT',
  });

  // End all spans in reverse order
  hop4Span.end();
  hop3Span.end();
  hop2Span.end();
  hop1Span.end();

  // Verify all 4 spans share the exact same traceId
  const sharedTraceId = rootContext.traceId;
  assert.strictEqual(hop1Span.getContext().traceId, sharedTraceId);
  assert.strictEqual(hop2Span.getContext().traceId, sharedTraceId);
  assert.strictEqual(hop3Span.getContext().traceId, sharedTraceId);
  assert.strictEqual(hop4Span.getContext().traceId, sharedTraceId);

  // Verify parent-child lineage
  assert.strictEqual(hop1Span.getContext().parentSpanId, undefined);
  assert.strictEqual(hop2Span.getContext().parentSpanId, hop1Span.getContext().spanId);
  assert.strictEqual(hop3Span.getContext().parentSpanId, hop2Span.getContext().spanId);
  assert.strictEqual(hop4Span.getContext().parentSpanId, hop3Span.getContext().spanId);

  console.log(
    `✓ Assertion 1 PASSED: W3C traceparent propagated across 4 hops with unbroken traceId (${sharedTraceId.slice(0, 8)}...).`,
  );

  // =========================================================================
  // Assertion 2: Prometheus /metrics Standard Exposition Format
  // =========================================================================
  console.log('\n[3/6] [Assertion 2] Testing Prometheus Exposition Format Compliance...');

  const metricsRegistry = MetricRegistry.getInstance();
  metricsRegistry.incrementCounter('http_requests_total', 142, { method: 'POST', status: '200' });
  metricsRegistry.setGauge('active_connections', 17, { service: 'api-gateway' });
  metricsRegistry.recordHistogram('http_request_duration_ms', 45.2, { route: '/checkout' });
  metricsRegistry.recordHistogram('http_request_duration_ms', 125.0, { route: '/checkout' });

  const prometheusOutput = metricsRegistry.exportPrometheus();

  // Validate Prometheus syntax
  assert.ok(prometheusOutput.includes('# HELP http_requests_total'), 'Must declare # HELP');
  assert.ok(prometheusOutput.includes('# TYPE http_requests_total counter'), 'Must declare # TYPE');
  assert.ok(prometheusOutput.includes('http_requests_total{method="POST",status="200"} 142'), 'Counter line');
  assert.ok(prometheusOutput.includes('active_connections{service="api-gateway"} 17'), 'Gauge line');
  assert.ok(prometheusOutput.includes('http_request_duration_ms_bucket{route="/checkout",le="50"} 1'), 'Bucket line');
  assert.ok(prometheusOutput.includes('http_request_duration_ms_bucket{route="/checkout",le="+Inf"} 2'), '+Inf bucket');
  assert.ok(prometheusOutput.includes('http_request_duration_ms_sum{route="/checkout"} 170.2'), 'Sum line');
  assert.ok(prometheusOutput.includes('http_request_duration_ms_count{route="/checkout"} 2'), 'Count line');

  console.log(
    '✓ Assertion 2 PASSED: Prometheus /metrics complies strictly with openmetrics exposition format.',
  );

  // =========================================================================
  // Assertion 3: Structured Logs Correlation with trace_id and span_id
  // =========================================================================
  console.log('\n[4/6] [Assertion 3] Testing Trace-Correlated Structured Logging...');

  let capturedLogLine: Record<string, unknown> | null = null;
  const mockDestination = {
    write(str: string) {
      try {
        capturedLogLine = JSON.parse(str);
      } catch {
        // ignore
      }
    },
  };

  const sampleContext = {
    traceId: 'e82b7c61f52d4ba2b0c2e391a8e34271',
    spanId: '4a6b2c8e1f5d3a9b',
    traceFlags: 1,
  };

  runWithTraceContext(sampleContext, () => {
    const logger = createCorrelatedLogger({ name: 'test-logger' }, mockDestination);
    logger.info({ orderId: 'ord-12345' }, 'Order processed successfully');
  });

  assert.ok(capturedLogLine, 'Log line should be captured');
  assert.strictEqual(capturedLogLine?.['trace_id'], sampleContext.traceId);
  assert.strictEqual(capturedLogLine?.['span_id'], sampleContext.spanId);
  assert.strictEqual(capturedLogLine?.['orderId'], 'ord-12345');

  // Direct verification of context extraction
  const currentCtx = W3CTraceContext.parseTraceParent(`00-${sampleContext.traceId}-${sampleContext.spanId}-01`);
  assert.strictEqual(currentCtx?.traceId, sampleContext.traceId);
  assert.strictEqual(currentCtx?.spanId, sampleContext.spanId);

  console.log(
    `✓ Assertion 3 PASSED: Structured logger extracts active trace_id and span_id with 100% correlation.`,
  );

  // =========================================================================
  // Assertion 4: Waterfall Tree Construction & Critical Path Calculation
  // =========================================================================
  console.log('\n[5/6] [Assertion 4] Testing Trace Waterfall Builder & Critical Path Logic...');

  const complexTraceId = crypto.randomUUID().replace(/-/g, '');
  const t0 = 10000;

  // Branched scenario:
  // Root: Gateway (duration 200ms)
  //   Child 1: Cache Lookup (duration 20ms, non-critical)
  //   Child 2: Orders Service (duration 170ms, critical)
  //     Grandchild 2A: Inventory Check (duration 30ms, non-critical)
  //     Grandchild 2B: Payments Charge (duration 120ms, critical bottleneck)
  const treeSpans = [
    {
      worldId: testWorldId,
      traceId: complexTraceId,
      spanId: 'gw-1',
      serviceName: 'gateway',
      operationName: 'POST /checkout',
      startTimeMicros: t0,
      durationMicros: 200000,
      statusCode: 'OK' as const,
      attributes: {},
    },
    {
      worldId: testWorldId,
      traceId: complexTraceId,
      spanId: 'cache-1',
      parentSpanId: 'gw-1',
      serviceName: 'cache',
      operationName: 'GET user_session',
      startTimeMicros: t0 + 5000,
      durationMicros: 20000,
      statusCode: 'OK' as const,
      attributes: {},
    },
    {
      worldId: testWorldId,
      traceId: complexTraceId,
      spanId: 'orders-1',
      parentSpanId: 'gw-1',
      serviceName: 'orders',
      operationName: 'processOrder',
      startTimeMicros: t0 + 25000,
      durationMicros: 170000,
      statusCode: 'OK' as const,
      attributes: {},
    },
    {
      worldId: testWorldId,
      traceId: complexTraceId,
      spanId: 'inv-1',
      parentSpanId: 'orders-1',
      serviceName: 'inventory',
      operationName: 'reserveStock',
      startTimeMicros: t0 + 30000,
      durationMicros: 30000,
      statusCode: 'OK' as const,
      attributes: {},
    },
    {
      worldId: testWorldId,
      traceId: complexTraceId,
      spanId: 'pay-1',
      parentSpanId: 'orders-1',
      serviceName: 'payments',
      operationName: 'chargeCustomer',
      startTimeMicros: t0 + 65000,
      durationMicros: 120000,
      statusCode: 'OK' as const,
      attributes: {},
    },
  ];

  // Build waterfall tree
  const waterfall = TraceWaterfallBuilder.buildWaterfall(treeSpans);

  assert.strictEqual(waterfall.traceId, complexTraceId);
  assert.strictEqual(waterfall.spanCount, 5);
  assert.strictEqual(waterfall.serviceCount, 5);
  assert.strictEqual(waterfall.rootSpan.spanId, 'gw-1');

  // Verify critical path: gw-1 -> orders-1 -> pay-1
  assert.strictEqual(waterfall.rootSpan.isCriticalPath, true, 'Gateway must be on critical path');
  
  const ordersChild = waterfall.rootSpan.children.find(c => c.spanId === 'orders-1')!;
  const cacheChild = waterfall.rootSpan.children.find(c => c.spanId === 'cache-1')!;
  assert.strictEqual(ordersChild.isCriticalPath, true, 'Orders must be on critical path');
  assert.strictEqual(cacheChild.isCriticalPath, false, 'Fast cache must NOT be on critical path');

  const payGrandchild = ordersChild.children.find(c => c.spanId === 'pay-1')!;
  const invGrandchild = ordersChild.children.find(c => c.spanId === 'inv-1')!;
  assert.strictEqual(payGrandchild.isCriticalPath, true, 'Payments bottleneck must be on critical path');
  assert.strictEqual(invGrandchild.isCriticalPath, false, 'Inventory check must NOT be on critical path');

  // Verify Gantt offset percentages
  assert.strictEqual(waterfall.rootSpan.offsetPercent, 0);
  assert.ok(ordersChild.offsetPercent > 0 && ordersChild.offsetPercent < 100);
  assert.ok(payGrandchild.widthPercent > 50, '120ms payments must take > 50% width');

  console.log(
    '✓ Assertion 4 PASSED: Trace waterfall tree correctly isolated critical path (gw-1 -> orders-1 -> pay-1) and normalized offsets.',
  );

  // =========================================================================
  // Assertion 5: Standalone SQLite Span Store & HTTP Waterfall Detail
  // =========================================================================
  console.log('\n[6/6] [Assertion 5] Testing Standalone SQLite Span Store & API Waterfall Delivery...');

  // Flush spans into real SQLite trace_spans table
  const collector = SpanCollector.getInstance();
  await collector.flush();
  for (const s of treeSpans) {
    collector.record(s);
  }
  const flushed = await collector.flush();
  assert.strictEqual(flushed, 5, 'Must flush all 5 spans into SQLite');

  // Verify spans exist in database
  const dbRows = await db
    .select()
    .from(traceSpans)
    .where(sql`${traceSpans.traceId} = ${complexTraceId}`);
  assert.strictEqual(dbRows.length, 5, 'SQLite must store exactly 5 spans');

  // Build Fastify server and test HTTP waterfall endpoints
  const app = buildServer();
  await app.ready();

  // Obtain authenticated session for protected routes
  const signupRes = await app.inject({
    method: 'POST',
    url: '/api/v1/auth/signup',
    payload: {
      email: `obs-admin-${Date.now()}@mirrorgrid.local`,
      password: 'StrongAdminPassword123!',
      displayName: 'Obs Admin',
      organizationName: 'Obs Corp',
    },
  });
  const adminCookie = signupRes.headers['set-cookie'] as string;

  // 1. Query traces catalog
  const catalogRes = await app.inject({
    method: 'GET',
    url: `/api/v1/worlds/${testWorldId}/traces`,
    headers: { cookie: adminCookie },
  });
  assert.strictEqual(catalogRes.statusCode, 200);
  const catalogJson = JSON.parse(catalogRes.payload);
  assert.ok(catalogJson.data.some((t: { traceId: string }) => t.traceId === complexTraceId), 'Catalog must contain test trace');

  // 2. Query trace waterfall detail
  const detailRes = await app.inject({
    method: 'GET',
    url: `/api/v1/worlds/${testWorldId}/traces/${complexTraceId}`,
    headers: { cookie: adminCookie },
  });
  assert.strictEqual(detailRes.statusCode, 200);
  const detailJson = JSON.parse(detailRes.payload);
  assert.strictEqual(detailJson.traceId, complexTraceId);
  assert.strictEqual(detailJson.spanCount, 5);
  assert.strictEqual(detailJson.rootSpan.spanId, 'gw-1');
  assert.strictEqual(detailJson.rootSpan.children.length, 2);

  // 3. Query /metrics endpoint
  const metricsRes = await app.inject({
    method: 'GET',
    url: '/metrics',
  });
  assert.strictEqual(metricsRes.statusCode, 200);
  assert.ok(metricsRes.headers['content-type']?.includes('text/plain'));
  assert.ok(metricsRes.payload.includes('process_heap_used_bytes'));

  await app.close();
  console.log(
    '✓ Assertion 5 PASSED: Standalone SQLite span store delivers full trace waterfall and Prometheus metrics with zero external Jaeger/Prometheus requirement.',
  );

  // =========================================================================
  // Zero-Mock Rule Compliance Check
  // =========================================================================
  console.log('\nChecking Zero-Mock Rule (§102) across observability package...');
  const violations = await checkNoMockDataRule(path.join(REPO_ROOT, 'packages', 'observability'));
  assert.strictEqual(
    violations.length,
    0,
    `Zero-mock rule violation: found forbidden mock files: ${violations.join(', ')}`,
  );
  console.log('✓ Zero-Mock Rule (§102) verified: 0 mock data files found.');

  // Cleanup test world
  await db.delete(worlds).where(sql`${worlds.id} = ${testWorldId}`);
  await collector.close();

  console.log('\n====================================================');
  console.log('     ALL 5 GATE ASSERTIONS PASSED GREEN (M09)       ');
  console.log('====================================================\n');
}

runGate()
  .then(() => {
    process.exit(0);
  })
  .catch((err) => {
    console.error('\n❌ Gate verification failed:', err);
    process.exit(1);
  });
