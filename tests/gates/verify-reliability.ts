/**
 * tests/gates/verify-reliability.ts
 *
 * M10: Reliability Intelligence Gate Verification Suite
 *
 * Validates the 5 Core SRE Assertions:
 * 1. Multi-window burn rate math strictly complies with Google SRE specifications (14.4x for 1h/5m, 6.0x for 6h/30m, 1.0x for 3d/6h).
 * 2. Dual-window multi-burn-rate requirement suppresses transient false-positive alerts when short window normalizes.
 * 3. Automated topological RCA isolates the true root cause in a 4-tier cascading failure (>90% confidence), rejecting ingress blame.
 * 4. Error budget accounting accurately tracks budget depletion, remaining headroom, and time-to-exhaustion.
 * 5. Executive reliability report compiler synthesizes comprehensive Markdown reviews with RCA, SLOs, and recommendations.
 *
 * Validates SQLite WAL persistence and Zero-Mock Rule (§102).
 */

import assert from 'node:assert';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  db,
  eq,
  runMigrations,
  worlds,
  organizations,
  users,
  services,
  serviceDependencies,
  serviceSlos,
  rcaInvestigations,
  reliabilityReports,
} from '../../packages/db/src/index.js';
import {
  calculateBurnRate,
  evaluateBurnRateRule,
  STANDARD_SRE_BURN_RULES,
  calculateErrorBudgetStatus,
  RcaEngine,
  ExecutiveReportCompiler,
  type GraphNode,
  type GraphEdge,
  type NodeMetrics,
} from '../../packages/sre/src/index.js';
import { buildServer } from '../../apps/control/src/server.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const REPO_ROOT = path.resolve(__dirname, '../..');

async function runReliabilityGate() {
  console.log('====================================================');
  console.log('       MIRRORGRID M10: SRE Reliability Gate        ');
  console.log('====================================================');

  await runMigrations();

  // =========================================================================
  // Assertion 1: Google SRE Multi-Window Burn Rate Math Verification
  // =========================================================================
  console.log('\n[1/6] [Assertion 1] Testing Google SRE Multi-Window Burn Rate Math...');

  const targetPercentage = 99.9; // 0.1% allowable error budget
  const allowableFraction = 0.001;

  // SRE Rule: 2% of 30-day budget in 1 hour
  // Window = 30 days = 720 hours.
  // 1 hour is 1/720 of the window.
  // Consuming 2% of budget in 1/720 of time:
  // Burn Rate = 0.02 / (1 / 720) = 14.4x!
  const total1hRequests = 100_000;
  // Bad requests for 14.4x burn rate = total * allowableFraction * 14.4 = 1440
  const bad1hRequests = 1440;
  const computedBurn1h = calculateBurnRate(total1hRequests, bad1hRequests, targetPercentage);
  assert.strictEqual(
    Number(computedBurn1h.toFixed(1)),
    14.4,
    `1-hour burn rate must be 14.4x (got ${computedBurn1h})`,
  );

  // SRE Rule: 5% of 30-day budget in 6 hours
  // 6 hours is 6/720 = 1/120 of window.
  // Consuming 5% of budget in 1/120 of time:
  // Burn Rate = 0.05 / (6 / 720) = 6.0x!
  const total6hRequests = 600_000;
  const bad6hRequests = total6hRequests * allowableFraction * 6.0; // 3600
  const computedBurn6h = calculateBurnRate(total6hRequests, bad6hRequests, targetPercentage);
  assert.strictEqual(
    Number(computedBurn6h.toFixed(1)),
    6.0,
    `6-hour burn rate must be 6.0x (got ${computedBurn6h})`,
  );

  // SRE Rule: 10% of 30-day budget in 3 days (72 hours)
  // 72 hours is 72/720 = 1/10 of window.
  // Consuming 10% of budget in 1/10 of time:
  // Burn Rate = 0.10 / (72 / 720) = 1.0x!
  const total3dRequests = 7_200_000;
  const bad3dRequests = total3dRequests * allowableFraction * 1.0; // 7200
  const computedBurn3d = calculateBurnRate(total3dRequests, bad3dRequests, targetPercentage);
  assert.strictEqual(
    Number(computedBurn3d.toFixed(1)),
    1.0,
    `3-day burn rate must be 1.0x (got ${computedBurn3d})`,
  );

  console.log(
    `✓ Assertion 1 PASSED: Multi-window burn rate math strictly complies with Google SRE specifications (14.4x, 6.0x, 1.0x).`,
  );

  // =========================================================================
  // Assertion 2: Dual-Window Requirement Suppresses Transient False Positives
  // =========================================================================
  console.log('\n[2/6] [Assertion 2] Testing Dual-Window False-Alarm Suppression...');

  const p1Rule = STANDARD_SRE_BURN_RULES.find((r) => r.severity === 'P1_CRITICAL')!;

  // Case A: Active Outage -> Both long window (1h) AND short window (5m) burning at >= 14.4x
  const activeIncident = evaluateBurnRateRule(
    p1Rule,
    targetPercentage,
    { totalRequests: 100_000, badRequests: 1440 }, // 1h long window: 14.4x
    { totalRequests: 8_000, badRequests: 120 },    // 5m short window: 15.0x
  );
  assert.strictEqual(activeIncident.shouldAlert, true, 'Active outage must trigger alert');

  // Case B: Transient Spike -> 1-hour window shows 14.4x from a spike 40 minutes ago,
  // but the last 5 minutes has self-healed and has 0 errors (0.0x burn rate).
  const transientSpike = evaluateBurnRateRule(
    p1Rule,
    targetPercentage,
    { totalRequests: 100_000, badRequests: 1440 }, // 1h long window: 14.4x
    { totalRequests: 8_000, badRequests: 0 },      // 5m short window: 0.0x (NORMAL)
  );
  assert.strictEqual(
    transientSpike.shouldAlert,
    false,
    'Transient spike must be suppressed when short window normalizes',
  );
  assert.ok(
    transientSpike.reason.includes('SUPPRESSED'),
    'Evaluation reason must explicitly indicate suppression',
  );

  console.log(
    `✓ Assertion 2 PASSED: Short window requirement successfully suppressed transient false alarm.`,
  );

  // =========================================================================
  // Assertion 3: Automated Topological RCA Isolates Root Cause (>90% confidence)
  // =========================================================================
  console.log('\n[3/6] [Assertion 3] Testing Graph-Theoretic Automated RCA on 4-Tier Cascade...');

  // Cascade Topology: Gateway -> Orders -> Payments -> Database
  const rcaNodes: GraphNode[] = [
    { id: 'gw-node', name: 'Gateway' },
    { id: 'orders-node', name: 'Orders' },
    { id: 'pay-node', name: 'Payments' },
    { id: 'db-node', name: 'Database' },
  ];

  const rcaEdges: GraphEdge[] = [
    { sourceId: 'gw-node', targetId: 'orders-node' },
    { sourceId: 'orders-node', targetId: 'pay-node' },
    { sourceId: 'pay-node', targetId: 'db-node' },
  ];

  // Failure Scenario:
  // Injected latency fault on Payments (+450ms).
  // Payments self latency: 450ms.
  // Orders thread pool exhausted waiting on Payments: Orders total 470ms, 120 errors.
  // Gateway 504 timeouts waiting on Orders: Gateway total 480ms, 300 errors (Highest error volume!).
  // Database: 2ms latency, 0 errors (100% healthy).
  const rcaMetrics: NodeMetrics[] = [
    {
      serviceId: 'gw-node',
      serviceName: 'Gateway',
      isDegraded: true,
      firstAnomalyTimestampMicros: 2200,
      totalLatencyMicros: 480_000,
      selfLatencyMicros: 10_000,
      errorCount: 300, // HIGHEST ERROR COUNT
      requestCount: 2000,
      metricType: '504_TIMEOUT',
      deviationFactor: 9.6,
    },
    {
      serviceId: 'orders-node',
      serviceName: 'Orders',
      isDegraded: true,
      firstAnomalyTimestampMicros: 1600,
      totalLatencyMicros: 470_000,
      selfLatencyMicros: 20_000,
      errorCount: 120,
      requestCount: 2000,
      metricType: 'QUEUE_SATURATION',
      deviationFactor: 6.4,
    },
    {
      serviceId: 'pay-node',
      serviceName: 'Payments',
      isDegraded: true,
      firstAnomalyTimestampMicros: 1000, // EARLIEST ORIGIN
      totalLatencyMicros: 452_000,
      selfLatencyMicros: 450_000, // HIGH INTERNAL EXECUTION DELAY
      errorCount: 8,
      requestCount: 2000,
      metricType: 'LATENCY_SPIKE',
      deviationFactor: 14.5,
    },
    {
      serviceId: 'db-node',
      serviceName: 'Database',
      isDegraded: false, // COMPLETELY HEALTHY
      firstAnomalyTimestampMicros: 0,
      totalLatencyMicros: 2_000,
      selfLatencyMicros: 2_000,
      errorCount: 0,
      requestCount: 2000,
      metricType: 'NORMAL',
      deviationFactor: 1.0,
    },
  ];

  const rcaResult = RcaEngine.analyze({
    nodes: rcaNodes,
    edges: rcaEdges,
    metrics: rcaMetrics,
  });

  // Assertion: The root cause MUST be Payments, NOT Gateway
  assert.strictEqual(
    rcaResult.rootCauseServiceId,
    'pay-node',
    `Root cause must be Payments (got ${rcaResult.rootCauseServiceId})`,
  );
  assert.strictEqual(
    rcaResult.rootCauseServiceName,
    'Payments',
    'Root cause service name must be Payments',
  );
  assert.ok(
    rcaResult.confidencePercentage >= 90.0,
    `Confidence percentage must exceed 90.0% (got ${rcaResult.confidencePercentage}%)`,
  );
  assert.strictEqual(rcaResult.failureType, 'LATENCY_INDUCED_SATURATION');
  assert.deepStrictEqual(
    rcaResult.causalPath.map((p) => p.serviceName),
    ['Gateway', 'Orders', 'Payments'],
  );
  assert.ok(
    rcaResult.explanation.includes('Payments') &&
      rcaResult.explanation.includes('Gateway ➔ Orders ➔ Payments'),
    'Explanation must detail topological propagation path',
  );

  console.log(
    `✓ Assertion 3 PASSED: Graph RCA isolated Payments as root cause with ${rcaResult.confidencePercentage}% confidence (Gateway dismissed as collateral symptom).`,
  );

  // =========================================================================
  // Assertion 4: Error Budget Accounting and Exhaustion Projection
  // =========================================================================
  console.log('\n[4/6] [Assertion 4] Testing Error Budget Accounting & Exhaustion...');

  // Setup: Target 99.9% over 30 days (720 hours)
  // Total requests: 50,000. 100 bad requests.
  // Unreliability rate: 100 / 50000 = 0.002 (0.2%).
  // Target allows: 0.001 (0.1%).
  // Burn rate: 0.002 / 0.001 = 2.0x.
  const budget = calculateErrorBudgetStatus({
    sloId: 'slo-orders-availability',
    targetPercentage: 99.9,
    currentPercentage: 99.8, // 0.2% error rate
    windowSeconds: 2592000,
    totalRequests: 50_000,
    badRequests: 100,
  });

  assert.strictEqual(budget.currentBurnRate, 2.0);
  assert.strictEqual(budget.isBurning, true);
  // With 200% consumed, budget remaining is 0%
  assert.strictEqual(budget.budgetRemainingPercent, 0);
  assert.strictEqual(budget.estimatedExhaustionHours, 0);

  // Headroom scenario: Target 99.9%, current 99.96% (only 40% of budget consumed)
  const headroomBudget = calculateErrorBudgetStatus({
    sloId: 'slo-orders-headroom',
    targetPercentage: 99.9,
    currentPercentage: 99.96,
    windowSeconds: 2592000,
    totalRequests: 100_000,
    badRequests: 40,
  });

  assert.strictEqual(headroomBudget.budgetRemainingPercent, 60.0);
  assert.strictEqual(headroomBudget.currentBurnRate, 0.4);
  assert.strictEqual(headroomBudget.isBurning, false);

  console.log(
    `✓ Assertion 4 PASSED: Error budget accounting accurately tracks budget depletion and remaining headroom.`,
  );

  // =========================================================================
  // Assertion 5: Executive Reliability Report Synthesis & API End-to-End
  // =========================================================================
  console.log('\n[5/6] [Assertion 5] Testing Executive Reliability Report Compiler & End-to-End API...');

  const report = ExecutiveReportCompiler.compile({
    title: 'Q3 Incident Forensics: Payments Gateway Slowdown',
    timeRangeStart: new Date(Date.now() - 3600_000),
    timeRangeEnd: new Date(),
    rca: rcaResult,
    budgets: [headroomBudget],
    mttdSeconds: 14,
    mttrSeconds: 48,
  });

  assert.ok(report.markdown.includes('# Executive Reliability Report'));
  assert.ok(report.markdown.includes('Root Cause Analysis (RCA)'));
  assert.ok(report.markdown.includes('Payments'));
  assert.ok(report.markdown.includes('LATENCY_INDUCED_SATURATION'));
  assert.ok(report.markdown.includes('graph LR'));
  assert.ok(report.recommendations.length > 0);
  assert.ok(report.overallScore > 0 && report.overallScore <= 100);

  // End-to-end Fastify API Verification
  const app = buildServer();
  await app.ready();

  const runId = Date.now();
  const testWorldId = `wld-sre-${runId}`;
  const testGwServiceId = `svc-gw-${runId}`;
  const testPayServiceId = `svc-pay-${runId}`;

  // Seed world, org, user, and services in SQLite WAL
  let org = (await db.select().from(organizations).limit(1))[0];
  if (!org) {
    const orgId = crypto.randomUUID();
    const [created] = await db
      .insert(organizations)
      .values({
        id: orgId,
        name: 'SRE Test Org',
        slug: `sre-test-org-${Date.now()}`,
      })
      .returning();
    org = created;
  }

  let user = (await db.select().from(users).limit(1))[0];
  if (!user) {
    const userId = crypto.randomUUID();
    const [created] = await db
      .insert(users)
      .values({
        id: userId,
        email: `sre-test-${Date.now()}@mirrorgrid.local`,
        passwordHash: 'dummy-hash',
        displayName: 'SRE Test User',
      })
      .returning();
    user = created;
  }

  await db.insert(worlds).values({
    id: testWorldId,
    organizationId: org.id,
    createdBy: user.id,
    name: `SRE Production Simulation World ${runId}`,
    status: 'READY',
  }).onConflictDoNothing();

  await db.insert(services).values([
    {
      id: testGwServiceId,
      worldId: testWorldId,
      name: 'api-gateway',
      serviceType: 'HTTP',
      status: 'HEALTHY',
    },
    {
      id: testPayServiceId,
      worldId: testWorldId,
      name: 'payment-processor',
      serviceType: 'HTTP',
      status: 'HEALTHY',
    },
  ]).onConflictDoNothing();

  await db.insert(serviceDependencies).values({
    worldId: testWorldId,
    sourceServiceId: testGwServiceId,
    targetServiceId: testPayServiceId,
    timeoutMs: 2000,
  }).onConflictDoNothing();

  // Obtain admin cookie
  const authEmail = `sre-admin-${Date.now()}@mirrorgrid.io`;
  const signupRes = await app.inject({
    method: 'POST',
    url: '/api/v1/auth/signup',
    payload: {
      email: authEmail,
      password: 'StrongPassword!2026',
      displayName: 'SRE Lead',
    },
  });
  const adminCookie = signupRes.headers['set-cookie'] as string;
  assert.ok(adminCookie, 'Must receive auth session cookie');

  // 1. Create SLO via API
  const createSloRes = await app.inject({
    method: 'POST',
    url: `/api/v1/worlds/${testWorldId}/slos`,
    headers: { cookie: adminCookie },
    payload: {
      serviceId: testPayServiceId,
      name: 'payment-availability',
      sliType: 'AVAILABILITY',
      targetPercentage: 99.9,
      windowSeconds: 2592000,
    },
  });
  assert.strictEqual(createSloRes.statusCode, 201);
  const sloData = JSON.parse(createSloRes.payload);
  assert.strictEqual(sloData.name, 'payment-availability');

  // 2. Query SLO Budget via API
  const getBudgetRes = await app.inject({
    method: 'GET',
    url: `/api/v1/worlds/${testWorldId}/slos/${sloData.id}/budget`,
    headers: { cookie: adminCookie },
  });
  assert.strictEqual(getBudgetRes.statusCode, 200);
  const budgetData = JSON.parse(getBudgetRes.payload);
  assert.strictEqual(budgetData.targetPercentage, 99.9);

  // 3. Trigger Automated RCA Analysis via API
  const rcaApiRes = await app.inject({
    method: 'POST',
    url: `/api/v1/worlds/${testWorldId}/rca/analyze`,
    headers: { cookie: adminCookie },
    payload: {
      overrideMetrics: [
        {
          serviceId: testGwServiceId,
          serviceName: 'api-gateway',
          isDegraded: true,
          firstAnomalyTimestampMicros: 2000,
          totalLatencyMicros: 500_000,
          selfLatencyMicros: 10_000,
          errorCount: 50,
          requestCount: 500,
          metricType: '504_TIMEOUT',
          deviationFactor: 8.0,
        },
        {
          serviceId: testPayServiceId,
          serviceName: 'payment-processor',
          isDegraded: true,
          firstAnomalyTimestampMicros: 1000,
          totalLatencyMicros: 490_000,
          selfLatencyMicros: 480_000,
          errorCount: 2,
          requestCount: 500,
          metricType: 'LATENCY_SPIKE',
          deviationFactor: 12.0,
        },
      ],
    },
  });
  assert.strictEqual(rcaApiRes.statusCode, 200);
  const rcaApiData = JSON.parse(rcaApiRes.payload);
  assert.strictEqual(rcaApiData.rootCauseServiceId, testPayServiceId);
  assert.ok(rcaApiData.confidencePercentage >= 90.0);

  // 4. Generate Executive Report via API
  const reportRes = await app.inject({
    method: 'POST',
    url: `/api/v1/worlds/${testWorldId}/reports/generate`,
    headers: { cookie: adminCookie },
    payload: {
      title: 'Monthly Service Reliability Review',
      timeRangeStart: new Date(Date.now() - 86400_000).toISOString(),
      timeRangeEnd: new Date().toISOString(),
    },
  });
  assert.strictEqual(reportRes.statusCode, 201);
  const reportData = JSON.parse(reportRes.payload);
  const md = reportData.reportMarkdown || reportData.markdown;
  assert.ok(md && md.includes('Root Cause Analysis'));
  assert.ok(reportData.overallScore > 0);

  // Verify SQLite Database rows
  const [dbSlo] = await db.select().from(serviceSlos).where(eq(serviceSlos.id, sloData.id));
  assert.ok(dbSlo, 'SLO record must persist in SQLite WAL');

  const [dbInvestigation] = await db
    .select()
    .from(rcaInvestigations)
    .where(eq(rcaInvestigations.id, rcaApiData.investigationId));
  assert.ok(dbInvestigation, 'RCA investigation record must persist in SQLite WAL');

  const [dbReport] = await db
    .select()
    .from(reliabilityReports)
    .where(eq(reliabilityReports.id, reportData.reportId));
  assert.ok(dbReport, 'Reliability report must persist in SQLite WAL');

  await app.close();

  console.log(
    `✓ Assertion 5 PASSED: Executive reliability report compiled and verified across end-to-end SQLite API routes.`,
  );

  // =========================================================================
  // Zero-Mock Rule (§102) Enforcement
  // =========================================================================
  console.log('\n[6/6] Checking Zero-Mock Rule (§102) across SRE package...');

  const sreFiles = fs.readdirSync(path.join(REPO_ROOT, 'packages/sre/src'), { recursive: true });
  for (const file of sreFiles) {
    if (typeof file === 'string' && (file.includes('mock') || file.includes('stub') || file.includes('fake'))) {
      throw new Error(`Zero-Mock Rule (§102) violation: found mock file ${file}`);
    }
  }

  console.log('✓ Zero-Mock Rule (§102) verified: 0 mock data files found.');

  console.log('\n====================================================');
  console.log('     ALL 5 GATE ASSERTIONS PASSED GREEN (M10)       ');
  console.log('====================================================\n');
}

runReliabilityGate().catch((err) => {
  console.error('\n❌ M10 Reliability Gate Failed:', err);
  process.exit(1);
});
