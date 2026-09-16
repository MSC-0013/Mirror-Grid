/**
 * tests/gates/verify-ha.ts
 *
 * M12: Kubernetes Orchestration & High Availability Gate Verification Suite
 *
 * Validates the 5 Core HA Assertions:
 * 1. Kubernetes manifests compile and validate cleanly against K8s OpenAPI schema.
 * 2. Multi-replica deployment boots in namespace and passes readiness probes.
 * 3. Graceful Pod termination under load achieves 100% availability (0 dropped requests).
 * 4. Rolling update completes under continuous traffic with zero downtime (maxUnavailable: 0).
 * 5. Ephemeral namespace teardown purges 100% of cluster resources cleanly.
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
  k8sClusters,
  k8sDeployments,
  k8sChaosEvents,
} from '../../packages/db/src/index.js';
import {
  ManifestGenerator,
  
  type TopologyServiceNode,
  type TopologyDependencyEdge,
} from '../../packages/k8s/src/index.js';
import { buildServer } from '../../apps/control/src/server.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const REPO_ROOT = path.resolve(__dirname, '../..');

async function runHaGate() {
  console.log('====================================================');
  console.log('    MIRRORGRID M12: Kubernetes & HA Gate            ');
  console.log('====================================================');

  await runMigrations();

  // Seed organization, user, and world in SQLite
  const orgId = crypto.randomUUID();
  await db.insert(organizations).values({
    id: orgId,
    name: `HA Org ${Date.now()}`,
    slug: `ha-org-${Date.now()}`,
  });

  const userId = crypto.randomUUID();
  await db.insert(users).values({
    id: userId,
    organizationId: orgId,
    email: `k8s-lead-${Date.now()}@mirrorgrid.io`,
    passwordHash: 'dummy-password-hash',
    displayName: 'K8s Cluster Admin',
  });

  const worldId = crypto.randomUUID();
  await db.insert(worlds).values({
    id: worldId,
    organizationId: orgId,
    createdBy: userId,
    name: `K8s Production Mesh ${Date.now()}`,
    status: 'READY',
  });

  // Seed 3 services with dependencies
  const sGateway = crypto.randomUUID();
  const sOrders = crypto.randomUUID();
  const sPayments = crypto.randomUUID();

  await db.insert(services).values([
    {
      id: sGateway,
      worldId,
      name: 'api-gateway',
      status: 'HEALTHY',
      serviceType: 'HTTP',
    },
    {
      id: sOrders,
      worldId,
      name: 'order-service',
      status: 'HEALTHY',
      serviceType: 'HTTP',
    },
    {
      id: sPayments,
      worldId,
      name: 'payment-service',
      status: 'HEALTHY',
      serviceType: 'HTTP',
    },
  ]);

  await db.insert(serviceDependencies).values([
    {
      id: crypto.randomUUID(),
      worldId,
      sourceServiceId: sGateway,
      targetServiceId: sOrders,
      protocol: 'HTTP',
    },
    {
      id: crypto.randomUUID(),
      worldId,
      sourceServiceId: sOrders,
      targetServiceId: sPayments,
      protocol: 'HTTP',
    },
  ]);

  console.log('✓ SQLite DB seeded with world topology and service mesh');

  // =========================================================================
  // Assertion 1: Kubernetes Manifests Compile & Validate Against OpenAPI Schema
  // =========================================================================
  console.log('\n[1/6] [Assertion 1] Testing World Manifest Compilation & OpenAPI Schema Validation...');

  const servicesList: TopologyServiceNode[] = [
    { id: sGateway, name: 'api-gateway', replicas: 3, port: 8080 },
    { id: sOrders, name: 'order-service', replicas: 3, port: 8081 },
    { id: sPayments, name: 'payment-service', replicas: 3, port: 8082 },
  ];
  const depsList: TopologyDependencyEdge[] = [
    { sourceServiceName: 'api-gateway', targetServiceName: 'order-service' },
    { sourceServiceName: 'order-service', targetServiceName: 'payment-service' },
  ];

  const manifestBundle = ManifestGenerator.compileWorld({
    worldId,
    services: servicesList,
    dependencies: depsList,
  });

  assert.strictEqual(manifestBundle.namespace, `mg-world-${worldId}`);
  assert.strictEqual(manifestBundle.deployments.length, 3);
  assert.strictEqual(manifestBundle.services.length, 3);
  assert.strictEqual(manifestBundle.networkPolicies.length, 3);

  // Validate all manifests
  for (const dep of manifestBundle.deployments) {
    const val = ManifestGenerator.validateSchema(dep);
    assert.strictEqual(val.valid, true, `Deployment schema invalid: ${val.errors.join(', ')}`);
    const spec = dep.spec as Record<string, unknown>;
    const strategy = spec.strategy as Record<string, unknown>;
    const rolling = strategy.rollingUpdate as Record<string, unknown>;
    assert.strictEqual(rolling.maxUnavailable, 0, 'maxUnavailable must be 0 for zero-downtime');
  }

  for (const svc of manifestBundle.services) {
    const val = ManifestGenerator.validateSchema(svc);
    assert.strictEqual(val.valid, true, `Service schema invalid: ${val.errors.join(', ')}`);
  }

  for (const np of manifestBundle.networkPolicies) {
    const val = ManifestGenerator.validateSchema(np);
    assert.strictEqual(val.valid, true, `NetworkPolicy schema invalid: ${val.errors.join(', ')}`);
  }

  console.log(
    `✓ Assertion 1 PASSED: Compiled 1 Namespace, 3 Deployments, 3 Services, and 3 NetworkPolicies validating OpenAPI v1.`,
  );

  // =========================================================================
  // Assertion 2: Multi-Replica Deployment Boots in Namespace & Passes Readiness
  // =========================================================================
  console.log('\n[2/6] [Assertion 2] Testing Multi-Replica Boot & Fastify Control Plane API...');

  const app = buildServer();
  await app.ready();

  const authEmail = `k8s-admin-${Date.now()}@mirrorgrid.io`;
  const signupRes = await app.inject({
    method: 'POST',
    url: '/api/v1/auth/signup',
    payload: {
      email: authEmail,
      password: 'StrongK8sPassword!2026',
      displayName: 'K8s Gate Admin',
      organizationName: 'K8s Cluster Corp',
    },
  });
  const adminCookie = signupRes.headers['set-cookie'] as string;

  // Deploy World to Kubernetes via Fastify API
  const deployRes = await app.inject({
    method: 'POST',
    url: `/api/v1/worlds/${worldId}/k8s/deploy`,
    headers: { cookie: adminCookie },
    payload: {
      replicasPerService: 3,
      enableNetworkPolicies: true,
    },
  });

  assert.strictEqual(deployRes.statusCode, 201, `Deploy failed with body: ${deployRes.payload}`);
  const deployBody = JSON.parse(deployRes.payload);
  assert.strictEqual(deployBody.success, true);
  assert.strictEqual(deployBody.data.totalDeployments, 3);
  assert.strictEqual(deployBody.data.totalPods, 9); // 3 services * 3 replicas
  assert.strictEqual(deployBody.data.healthyPods, 9);
  assert.strictEqual(deployBody.data.allPodsReady, true);

  // Verify status endpoint
  const statusRes = await app.inject({
    method: 'GET',
    url: `/api/v1/worlds/${worldId}/k8s/status`,
    headers: { cookie: adminCookie },
  });
  assert.strictEqual(statusRes.statusCode, 200);
  const statusBody = JSON.parse(statusRes.payload);
  assert.strictEqual(statusBody.data.totalPods, 9);
  assert.strictEqual(statusBody.data.healthyPods, 9);
  assert.strictEqual(statusBody.data.allPodsReady, true);

  // Verify SQLite WAL persistence of deployment record
  const dbDeployments = await db
    .select()
    .from(k8sDeployments)
    .where(eq(k8sDeployments.worldId, worldId));
  assert.strictEqual(dbDeployments.length, 1);
  assert.strictEqual(dbDeployments[0]!.status, 'RUNNING');
  assert.strictEqual(dbDeployments[0]!.totalPods, 9);

  console.log(
    `✓ Assertion 2 PASSED: 9 pods across 3 deployments booted and passed readiness probes in namespace ${deployBody.data.namespace}.`,
  );

  // =========================================================================
  // Assertion 3: Graceful Pod Termination Under Load (100% HA Availability)
  // =========================================================================
  console.log('\n[3/6] [Assertion 3] Testing Graceful Pod Kill Chaos under 250 req/s continuous traffic...');

  const podKillRes = await app.inject({
    method: 'POST',
    url: `/api/v1/worlds/${worldId}/k8s/chaos/pod-kill`,
    headers: { cookie: adminCookie },
    payload: {
      serviceName: 'order-service',
      trafficRps: 250,
      testDurationSeconds: 2,
    },
  });

  assert.strictEqual(podKillRes.statusCode, 200, `Pod kill failed: ${podKillRes.payload}`);
  const podKillBody = JSON.parse(podKillRes.payload);
  assert.strictEqual(podKillBody.success, true);
  const killResult = podKillBody.data.testResult;
  assert.strictEqual(killResult.testType, 'POD_KILL');
  assert.strictEqual(killResult.failedRequests, 0, 'Zero requests must fail during preStop drain');
  assert.strictEqual(killResult.availabilityPercentage, 100.0, 'Must achieve 100% availability');
  assert.strictEqual(killResult.zeroDowntimeAchieved, true);

  // Verify chaos event persisted in SQLite
  const chaosEvents = await db
    .select()
    .from(k8sChaosEvents)
    .where(eq(k8sChaosEvents.id, podKillBody.data.eventId));
  assert.strictEqual(chaosEvents.length, 1);
  assert.strictEqual(chaosEvents[0]!.chaosType, 'POD_KILL');
  assert.strictEqual(chaosEvents[0]!.availabilityPercentage, 100.0);
  assert.strictEqual(chaosEvents[0]!.requestsFailed, 0);

  console.log(
    `✓ Assertion 3 PASSED: Pod kill survived 500 requests with 0 drops (100% availability, preStop drain verified).`,
  );

  // =========================================================================
  // Assertion 4: Zero-Downtime Rolling Update Under Continuous Traffic
  // =========================================================================
  console.log('\n[4/6] [Assertion 4] Testing Rolling Update under 300 req/s load (maxSurge: 1, maxUnavailable: 0)...');

  const rollingRes = await app.inject({
    method: 'POST',
    url: `/api/v1/worlds/${worldId}/k8s/chaos/rolling-update`,
    headers: { cookie: adminCookie },
    payload: {
      serviceName: 'payment-service',
      newImageTag: 'mirrorgrid/payment-service:v2.1',
      trafficRps: 300,
    },
  });

  assert.strictEqual(rollingRes.statusCode, 200, `Rolling update failed: ${rollingRes.payload}`);
  const rollingBody = JSON.parse(rollingRes.payload);
  assert.strictEqual(rollingBody.success, true);
  const rollResult = rollingBody.data.testResult;
  assert.strictEqual(rollResult.testType, 'ROLLING_UPDATE');
  assert.strictEqual(rollResult.failedRequests, 0, 'Zero requests must fail during rolling deploy');
  assert.strictEqual(rollResult.availabilityPercentage, 100.0);
  assert.strictEqual(rollResult.zeroDowntimeAchieved, true);

  // Verify chaos event in SQLite
  const rollEvents = await db
    .select()
    .from(k8sChaosEvents)
    .where(eq(k8sChaosEvents.id, rollingBody.data.eventId));
  assert.strictEqual(rollEvents.length, 1);
  assert.strictEqual(rollEvents[0]!.chaosType, 'ROLLING_UPDATE');
  assert.strictEqual(rollEvents[0]!.availabilityPercentage, 100.0);

  console.log(
    `✓ Assertion 4 PASSED: Rolling update completed with 0 errors across 600 requests (zero-downtime verified).`,
  );

  // =========================================================================
  // Assertion 5: Ephemeral Namespace Teardown & Clean Cascade Resource Purge
  // =========================================================================
  console.log('\n[5/6] [Assertion 5] Testing Ephemeral Namespace Teardown & Cascade Resource Purge...');

  const teardownRes = await app.inject({
    method: 'DELETE',
    url: `/api/v1/worlds/${worldId}/k8s/teardown`,
    headers: { cookie: adminCookie },
  });

  assert.strictEqual(teardownRes.statusCode, 200, `Teardown failed: ${teardownRes.payload}`);
  const teardownBody = JSON.parse(teardownRes.payload);
  assert.strictEqual(teardownBody.success, true);
  assert.ok(teardownBody.data.purgedPodCount > 0);
  assert.strictEqual(teardownBody.data.namespaceCleanlyDeleted, true);

  // Verify SQLite record updated to TERMINATED
  const updatedDeployment = await db
    .select()
    .from(k8sDeployments)
    .where(eq(k8sDeployments.id, teardownBody.data.deploymentId));
  assert.strictEqual(updatedDeployment.length, 1);
  assert.strictEqual(updatedDeployment[0]!.status, 'TERMINATED');
  assert.ok(updatedDeployment[0]!.terminatedAt !== null);

  console.log(
    `✓ Assertion 5 PASSED: Namespace ${teardownBody.data.namespace} torn down, ${teardownBody.data.purgedPodCount} pods cleanly purged.`,
  );

  // =========================================================================
  // Assertion 6: Zero-Mock Rule (§102) & SQLite Table Schema Integrity
  // =========================================================================
  console.log('\n[6/6] [Assertion 6] Auditing Zero-Mock Rule (§102) and SQLite WAL persistence...');

  const k8sDir = path.join(REPO_ROOT, 'packages', 'k8s');
  const checkDirForMocks = (dir: string) => {
    const entries = fs.readdirSync(dir, { withFileTypes: true });
    for (const entry of entries) {
      const fullPath = path.join(dir, entry.name);
      if (entry.isDirectory()) {
        checkDirForMocks(fullPath);
      } else if (entry.name.endsWith('.ts') && !entry.name.endsWith('.d.ts')) {
        const content = fs.readFileSync(fullPath, 'utf8');
        assert.ok(
          !content.includes('jest.mock') &&
            !content.includes('sinon') &&
            !content.includes('vi.fn(') &&
            !content.includes('new Mock'),
          `Zero-Mock Rule (§102) violation in ${fullPath}`,
        );
      }
    }
  };
  checkDirForMocks(k8sDir);

  const clusterCount = await db.select().from(k8sClusters);
  const deployCount = await db.select().from(k8sDeployments);
  const chaosCount = await db.select().from(k8sChaosEvents);

  assert.ok(clusterCount.length >= 1, 'k8s_clusters table must contain records');
  assert.ok(deployCount.length >= 1, 'k8s_deployments table must contain records');
  assert.ok(chaosCount.length >= 2, 'k8s_chaos_events table must contain records');

  console.log('✓ Assertion 6 PASSED: Zero mocks detected. All state persisted to SQLite WAL database.');

  await app.close();

  console.log('\n====================================================');
  console.log('       ALL M12 HA GATE ASSERTIONS CERTIFIED GREEN   ');
  console.log('====================================================\n');
}

runHaGate().catch((err) => {
  console.error('\n❌ M12 HA GATE FAILED:', err);
  process.exit(1);
});
