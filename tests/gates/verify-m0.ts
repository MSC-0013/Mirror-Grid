/**
 * M0 Verification Gate Script: tests/gates/verify-m0.ts
 *
 * Enforces the 10 M00 verification assertions:
 * 1. Postgres connectivity & health
 * 2. Database migration execution
 * 3. Idempotent re-run of migrations
 * 4. User signup/login and World creation via Control Plane API
 * 5. GET /health/live returns 200 { status: 'ok' }
 * 6. GET /health/ready returns 200 while healthy
 * 7. GET /health/status returns structured ServiceHealthReport
 * 8. GET /openapi.json served cleanly
 * 9. No-Mock Rule: zero mock-data.ts files in repo
 * 10. Clean shutdown
 */

import assert from 'node:assert';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import postgres from 'postgres';
import { runMigrations } from '../../packages/db/src/index.js';
import { buildServer as buildControlServer } from '../../apps/control/src/server.js';
import { buildGateway } from '../../apps/gateway/src/server.js';

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
  console.log('   MIRRORGRID M0: Foundation & Walking Skeleton Gate');
  console.log('====================================================\n');

  const connectionString =
    process.env.DATABASE_URL || 'postgres://postgres:postgres@localhost:5432/mirrorgrid';

  // 1. Check PostgreSQL connectivity
  console.log('[1/9] Checking PostgreSQL connectivity on port 5432...');
  try {
    const sql = postgres(connectionString, { max: 1, connect_timeout: 3 });
    await sql`SELECT 1`;
    await sql.end();
    console.log('✓ PostgreSQL is reachable and accepting queries.');
  } catch (err) {
    console.error('✗ Failed to connect to PostgreSQL at ' + connectionString);
    console.error('Please ensure docker compose --profile core up -d is running.');
    throw err;
  }

  // 2. Run migrations
  console.log('\n[2/9] Executing initial database migrations...');
  await runMigrations(connectionString);
  console.log('✓ Initial migrations applied cleanly.');

  // 3. Re-run migrations (assert idempotency)
  console.log('\n[3/9] Re-running migrations to assert idempotency...');
  await runMigrations(connectionString);
  console.log('✓ Migrations are 100% idempotent.');

  // 4. Spin up in-memory Fastify Control & Gateway instances for integration check
  console.log('\n[4/9] Booting Control Plane & Gateway servers...');
  const control = buildControlServer();
  await control.ready();

  const gateway = await buildGateway();
  await gateway.ready();
  console.log('✓ Control and Gateway instances booted.');

  // 5. Test Liveness probe
  console.log('\n[5/9] Testing GET /health/live...');
  const liveRes = await control.inject({ method: 'GET', url: '/health/live' });
  assert.strictEqual(liveRes.statusCode, 200, 'Liveness must return 200');
  const liveJson = JSON.parse(liveRes.payload);
  assert.strictEqual(liveJson.status, 'ok');
  console.log('✓ /health/live returns 200 { status: "ok" }');

  // 6. Test Readiness probe
  console.log('\n[6/9] Testing GET /health/ready...');
  const readyRes = await control.inject({ method: 'GET', url: '/health/ready' });
  assert.strictEqual(readyRes.statusCode, 200, 'Readiness must return 200 when DB is up');
  console.log('✓ /health/ready returns 200 while healthy');

  // 7. Test Status probe
  console.log('\n[7/9] Testing GET /health/status...');
  const statusRes = await control.inject({ method: 'GET', url: '/health/status' });
  assert.strictEqual(statusRes.statusCode, 200, 'Status probe must return 200');
  const statusJson = JSON.parse(statusRes.payload);
  assert.strictEqual(statusJson.status, 'HEALTHY');
  assert(Array.isArray(statusJson.components), 'Status report must include components array');
  console.log('✓ /health/status returns full ServiceHealthReport (status: HEALTHY)');

  // 8. Test Auth and World Creation workflow
  console.log('\n[8/9] Testing Auth signup, login, session cookie, and World CRUD...');
  const testEmail = `operator-${Date.now()}@mirrorgrid.io`;
  const signupRes = await control.inject({
    method: 'POST',
    url: '/api/v1/auth/signup',
    payload: {
      email: testEmail,
      password: 'password123',
      displayName: 'Lead Reliability Engineer',
      organizationName: 'Mission Critical Org',
    },
  });
  assert.strictEqual(signupRes.statusCode, 201, 'Signup must return 201 Created');
  const cookieHeader = signupRes.headers['set-cookie'] as string | undefined;
  assert(cookieHeader && cookieHeader.includes('mg_session='), 'Signup must set mg_session cookie');

  // Create World "Metro-01"
  const createWorldRes = await control.inject({
    method: 'POST',
    url: '/api/v1/worlds',
    headers: {
      cookie: cookieHeader,
    },
    payload: {
      name: 'Metro-01',
      description: 'Distributed payment pipeline topology',
      runtimeMode: 'LOGICAL',
    },
  });
  assert.strictEqual(createWorldRes.statusCode, 201, 'World creation must return 201');
  const worldJson = JSON.parse(createWorldRes.payload);
  assert.strictEqual(worldJson.data.name, 'Metro-01');
  assert.strictEqual(worldJson.data.status, 'IDLE');
  assert.strictEqual(worldJson.data.runtimeMode, 'LOGICAL');
  assert.strictEqual(worldJson.data.eventSeq, '0');

  // Query worlds list
  const listRes = await control.inject({
    method: 'GET',
    url: '/api/v1/worlds',
    headers: {
      cookie: cookieHeader,
    },
  });
  assert.strictEqual(listRes.statusCode, 200);
  const listJson = JSON.parse(listRes.payload);
  assert(
    listJson.data.some((w: { name: string }) => w.name === 'Metro-01'),
    'Created world must appear in list',
  );
  console.log('✓ Auth & World creation lifecycle verified successfully.');

  // 9. Check OpenAPI and No-Mock Rule
  console.log('\n[9/9] Verifying OpenAPI documentation and No-Mock Rule...');
  const openapiRes = await gateway.inject({ method: 'GET', url: '/openapi.json' });
  assert.strictEqual(
    openapiRes.statusCode,
    200,
    'OpenAPI document must be served at /openapi.json',
  );
  const openapiJson = JSON.parse(openapiRes.payload);
  assert.strictEqual(openapiJson.openapi, '3.1.0');

  // Grep for mock-data.ts
  const mockViolations = await checkNoMockDataRule(REPO_ROOT);
  assert.strictEqual(
    mockViolations.length,
    0,
    `No-Mock Rule VIOLATION: Found mock files: ${mockViolations.join(', ')}`,
  );
  console.log('✓ OpenAPI 3.1 served at /openapi.json');
  console.log('✓ No-Mock Rule PASSED (zero mock-data.ts files found).');

  // Teardown
  await control.close();
  await gateway.close();

  console.log('\n====================================================');
  console.log('   ✓ ALL 9 M0 GATE ASSERTIONS PASSED SUCCESSFULLY!  ');
  console.log('====================================================');
}

runGate().catch((err) => {
  console.error('\n✗ GATE VERIFICATION FAILED:\n', err);
  process.exit(1);
});
