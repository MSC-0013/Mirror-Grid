/**
 * M1 Verification Gate Script: tests/gates/verify-m1.ts
 *
 * Enforces the Milestone M01 verification assertions:
 * 1. Seed §10 reference topology (Gateway, Orders, Users, Inventory, Payments, Postgres) via API (0 SQL inserts).
 * 2. GET /api/v1/worlds/:worldId/graph returns 6 services and 8 edges with metrics.
 * 3. Topology graph structure verified (criticalPathLength = 4, hasCycles = false).
 * 4. Cycle detection check: POST a dependency creating a cycle -> 422 with cycle path array.
 * 5. reachableFrom('payments') returns exact set: { orders, gateway }.
 * 6. DELETE service with dependents -> 409 Conflict.
 * 7. Invariant §115.2: No dangling edges after 409 rejection.
 * 8. No-Mock Rule: zero mock-data.ts files in repository.
 */

import assert from 'node:assert';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import postgres from 'postgres';
import { runMigrations } from '../../packages/db/src/index.js';
import { buildServer as buildControlServer } from '../../apps/control/src/server.js';
import { DependencyGraph, reachableFrom } from '@mirrorgrid/domain';

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

async function runM1Gate() {
  console.log('====================================================');
  console.log('   MIRRORGRID M1: Domain Model & Topology Gate');
  console.log('====================================================\n');

  const connectionString =
    process.env.DATABASE_URL || 'postgres://postgres:postgres@localhost:5432/mirrorgrid';

  // 1. Check database connectivity and migrations
  console.log('[1/8] Verifying database connectivity & migrations...');
  const sql = postgres(connectionString, { max: 1, connect_timeout: 3 });
  await sql`SELECT 1`;
  await sql.end();
  await runMigrations(connectionString);
  console.log('✓ PostgreSQL connected and migrations up to date.');

  // 2. Boot Control Plane
  console.log('\n[2/8] Booting Control Plane server...');
  const control = buildControlServer();
  await control.ready();
  console.log('✓ Control Plane booted.');

  // 3. Authenticate and create World
  console.log('\n[3/8] Creating test World for topology validation...');
  const testEmail = `operator-m1-${Date.now()}@mirrorgrid.io`;
  const signupRes = await control.inject({
    method: 'POST',
    url: '/api/v1/auth/signup',
    payload: {
      email: testEmail,
      password: 'password123',
      displayName: 'Topology Architect',
      organizationName: 'Grid Systems Corp',
    },
  });
  assert.strictEqual(signupRes.statusCode, 201);
  const cookieHeader = signupRes.headers['set-cookie'] as string;

  const createWorldRes = await control.inject({
    method: 'POST',
    url: '/api/v1/worlds',
    headers: { cookie: cookieHeader },
    payload: {
      name: `Metro-Topology-${Date.now()}`,
      description: 'Reference 6-service microservice DAG',
      runtimeMode: 'LOGICAL',
    },
  });
  assert.strictEqual(createWorldRes.statusCode, 201);
  const worldId = JSON.parse(createWorldRes.payload).data.id;
  console.log(`✓ World provisioned: ${worldId}`);

  // 4. Seed the §10 Reference Topology via API (0 SQL inserts)
  console.log('\n[4/8] Seeding §10 reference topology via API...');
  const serviceDefs = [
    { name: 'gateway', serviceType: 'HTTP', targetInstances: 2, concurrencyLimit: 128 },
    { name: 'orders', serviceType: 'HTTP', targetInstances: 2, concurrencyLimit: 64 },
    { name: 'users', serviceType: 'HTTP', targetInstances: 1, concurrencyLimit: 64 },
    { name: 'inventory', serviceType: 'HTTP', targetInstances: 2, concurrencyLimit: 64 },
    { name: 'payments', serviceType: 'HTTP', targetInstances: 2, concurrencyLimit: 64 },
    { name: 'postgres', serviceType: 'DATABASE', targetInstances: 1, concurrencyLimit: 256 },
  ];

  const serviceIdMap: Record<string, string> = {};
  for (const def of serviceDefs) {
    const res = await control.inject({
      method: 'POST',
      url: `/api/v1/worlds/${worldId}/services`,
      headers: { cookie: cookieHeader },
      payload: def,
    });
    assert.strictEqual(res.statusCode, 201, `Failed to create service ${def.name}`);
    const body = JSON.parse(res.payload);
    serviceIdMap[def.name] = body.data.id;
  }
  assert.strictEqual(Object.keys(serviceIdMap).length, 6, 'All 6 services created');

  // Define 8 edges:
  // gateway -> orders, users
  // orders -> inventory, payments, postgres
  // inventory -> postgres
  // payments -> postgres
  // users -> postgres
  const edgeDefs = [
    { source: 'gateway', target: 'orders', timeoutMs: 5000, criticality: 'REQUIRED' },
    { source: 'gateway', target: 'users', timeoutMs: 3000, criticality: 'OPTIONAL' },
    { source: 'orders', target: 'inventory', timeoutMs: 4000, criticality: 'REQUIRED' },
    { source: 'orders', target: 'payments', timeoutMs: 6000, criticality: 'REQUIRED' },
    { source: 'orders', target: 'postgres', timeoutMs: 2000, criticality: 'REQUIRED' },
    { source: 'inventory', target: 'postgres', timeoutMs: 2000, criticality: 'REQUIRED' },
    { source: 'payments', target: 'postgres', timeoutMs: 2500, criticality: 'REQUIRED' },
    { source: 'users', target: 'postgres', timeoutMs: 2000, criticality: 'REQUIRED' },
  ];

  for (const edge of edgeDefs) {
    const res = await control.inject({
      method: 'POST',
      url: `/api/v1/worlds/${worldId}/dependencies`,
      headers: { cookie: cookieHeader },
      payload: {
        sourceServiceId: serviceIdMap[edge.source],
        targetServiceId: serviceIdMap[edge.target],
        timeoutMs: edge.timeoutMs,
        criticality: edge.criticality,
      },
    });
    assert.strictEqual(
      res.statusCode,
      201,
      `Failed to create edge ${edge.source} -> ${edge.target}`,
    );
  }
  console.log('✓ Successfully seeded 6 services and 8 dependencies purely via API.');

  // 5. Test GET /graph endpoint
  console.log('\n[5/8] Verifying GET /api/v1/worlds/:worldId/graph...');
  const graphRes = await control.inject({
    method: 'GET',
    url: `/api/v1/worlds/${worldId}/graph`,
    headers: { cookie: cookieHeader },
  });
  assert.strictEqual(graphRes.statusCode, 200);
  const graphJson = JSON.parse(graphRes.payload).data;

  assert.strictEqual(graphJson.services.length, 6, 'Graph must contain 6 services');
  assert.strictEqual(graphJson.dependencies.length, 8, 'Graph must contain 8 edges');
  assert.strictEqual(graphJson.metrics.serviceCount, 6);
  assert.strictEqual(graphJson.metrics.edgeCount, 8);
  assert.strictEqual(graphJson.metrics.hasCycles, false, 'Reference topology must be a valid DAG');
  assert.strictEqual(graphJson.metrics.criticalPathLength, 4, 'Critical path length must be 4');
  console.log('✓ GET /graph returns 6 services, 8 edges, and criticalPathLength = 4.');

  // 6. Test Cycle Detection (POST dependency creating cycle -> 422)
  console.log('\n[6/8] Testing Cycle Detection on write (POST dependency creating cycle)...');
  const cycleAttemptRes = await control.inject({
    method: 'POST',
    url: `/api/v1/worlds/${worldId}/dependencies`,
    headers: { cookie: cookieHeader },
    payload: {
      sourceServiceId: serviceIdMap['payments'],
      targetServiceId: serviceIdMap['gateway'],
      timeoutMs: 1000,
    },
  });
  assert.strictEqual(
    cycleAttemptRes.statusCode,
    422,
    'Cycle must be rejected with 422 Unprocessable Entity',
  );
  const cycleBody = JSON.parse(cycleAttemptRes.payload);
  assert(
    cycleBody.error.message.includes('Cycle detected'),
    'Error message must state cycle detected',
  );
  assert(Array.isArray(cycleBody.error.details.cycle), 'Response must contain cycle path array');
  console.log(`✓ Cycle rejected with 422: ${cycleBody.error.message}`);

  // 7. Reachability & Cascading Delete Protection
  console.log('\n[7/8] Testing reachability analysis & dependent deletion guard (409)...');
  // Reachable test:
  const localGraph = new DependencyGraph(Object.values(serviceIdMap));
  for (const edge of edgeDefs) {
    localGraph.addEdge(serviceIdMap[edge.source], serviceIdMap[edge.target]);
  }
  const paymentsCallers = reachableFrom(localGraph, serviceIdMap['payments']);
  assert.strictEqual(paymentsCallers.size, 2);
  assert(paymentsCallers.has(serviceIdMap['orders']));
  assert(paymentsCallers.has(serviceIdMap['gateway']));
  console.log('✓ reachableFrom("payments") returned exact set: { orders, gateway }');

  // Deletion guard test:
  const deleteRes = await control.inject({
    method: 'DELETE',
    url: `/api/v1/worlds/${worldId}/services/${serviceIdMap['payments']}`,
    headers: { cookie: cookieHeader },
  });
  assert.strictEqual(
    deleteRes.statusCode,
    409,
    'Deleting service with dependents must return 409 Conflict',
  );
  console.log('✓ DELETE /services/:paymentsId rejected with 409 Conflict (dependents exist).');

  // Assert no dangling edges:
  const depsRes = await control.inject({
    method: 'GET',
    url: `/api/v1/worlds/${worldId}/dependencies`,
    headers: { cookie: cookieHeader },
  });
  const currentDeps = JSON.parse(depsRes.payload).data;
  assert.strictEqual(currentDeps.length, 8, 'Zero dangling edges created: count remains 8');
  console.log('✓ Invariant §115.2 confirmed: dependency edge count unchanged at 8.');

  // 8. No-Mock Rule
  console.log('\n[8/8] Verifying No-Mock Rule...');
  const mockViolations = await checkNoMockDataRule(REPO_ROOT);
  assert.strictEqual(
    mockViolations.length,
    0,
    `No-Mock Rule VIOLATION: Found mock files: ${mockViolations.join(', ')}`,
  );
  console.log('✓ No-Mock Rule PASSED (0 mock-data.ts files in repository).');

  await control.close();

  console.log('\n====================================================');
  console.log('   ✓ ALL 8 M1 GATE ASSERTIONS PASSED SUCCESSFULLY!  ');
  console.log('====================================================\n');
}

runM1Gate()
  .then(() => process.exit(0))
  .catch((err) => {
    console.error('M1 Gate verification failed:', err);
    process.exit(1);
  });
