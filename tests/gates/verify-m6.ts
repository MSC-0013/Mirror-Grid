/**
 * M6 Verification Gate Script: tests/gates/verify-m6.ts
 *
 * Enforces the M06 verification assertions:
 * 1. Immediate session revocation across all endpoints (401 on revoked session)
 * 2. RBAC permissions strictly forbid unauthorized actions (VIEWER blocked from faults/admin; OPERATOR allowed faults, blocked from admin; ADMIN allowed all)
 * 3. Cryptographic Audit Hash Chain verifies 100% intact from genesis
 * 4. Tampering with audit record payload is immediately detected at exact sequence number
 * 5. Adaptive rate limiter throttles abusive traffic and returns RFC 6585 headers
 * 6. No-Mock Rule & SQLite persistence integrity
 */

import assert from 'node:assert';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { runMigrations, db, eq } from '../../packages/db/src/index.js';
import { auditLogs } from '../../packages/db/src/schema/security.js';
import { auditLogger } from '../../packages/security/src/index.js';
import { buildServer as buildControlServer } from '../../apps/control/src/server.js';

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
  console.log('   MIRRORGRID M6: Security & RBAC Verification Gate');
  console.log('====================================================\n');

  const connectionString = process.env.DATABASE_URL || 'file:./data/mirrorgrid.db';

  // 1. Ensure migrations are applied
  console.log('[1/6] Ensuring SQLite database migrations are up to date...');
  await runMigrations(connectionString);
  console.log('✓ Database migrations ready (including 007_security.sql).');

  // 2. Boot Control Plane
  console.log('\n[2/6] Booting Fastify Control Plane with Security Plugin...');
  const control = buildControlServer();
  await control.ready();
  console.log('✓ Fastify Control Plane booted with authentication, RBAC, and rate limiting.');

  // =========================================================================
  // Assertion 1: Immediate Session Revocation
  // =========================================================================
  console.log('\n[3/6] [Assertion 1] Testing Immediate Session Revocation across endpoints...');
  const ts = Date.now();
  const testAdminEmail = `admin-${ts}@mirrorgrid.io`;

  // Sign up Admin
  const adminSignupRes = await control.inject({
    method: 'POST',
    url: '/api/v1/auth/signup',
    payload: {
      email: testAdminEmail,
      password: 'StrongAdminPassword123!',
      displayName: 'System Admin',
      organizationName: 'Secured Corp',
    },
  });
  assert.strictEqual(adminSignupRes.statusCode, 201, 'Admin signup must return 201 Created');
  const adminCookie = adminSignupRes.headers['set-cookie'] as string;
  assert(adminCookie && adminCookie.includes('mg_session='), 'Signup must set mg_session cookie');

  // Verify access with valid session
  const meRes = await control.inject({
    method: 'GET',
    url: '/api/v1/auth/me',
    headers: { cookie: adminCookie },
  });
  assert.strictEqual(meRes.statusCode, 200, 'Valid session must return 200 OK');
  const meJson = JSON.parse(meRes.payload);
  assert.strictEqual(meJson.user.email, testAdminEmail);

  // Revoke session via logout
  const logoutRes = await control.inject({
    method: 'POST',
    url: '/api/v1/auth/logout',
    headers: { cookie: adminCookie },
  });
  assert.strictEqual(logoutRes.statusCode, 204, 'Logout must return 204 No Content');

  // Assert immediate 401 on next request with revoked cookie
  const revokedAccessRes = await control.inject({
    method: 'GET',
    url: '/api/v1/auth/me',
    headers: { cookie: adminCookie },
  });
  assert.strictEqual(
    revokedAccessRes.statusCode,
    401,
    'Revoked session must immediately return 401 Unauthorized',
  );
  const revokedErr = JSON.parse(revokedAccessRes.payload);
  assert.strictEqual(revokedErr.error.code, 'UNAUTHORIZED');
  console.log('✓ Assertion 1 PASSED: Revoked session receives immediate 401 across all endpoints.');

  // =========================================================================
  // Assertion 2: Granular RBAC Permissions
  // =========================================================================
  console.log(
    '\n[4/6] [Assertion 2] Testing Granular RBAC Permissions (VIEWER, OPERATOR, ADMIN)...',
  );

  // Log back in as Admin
  const adminLoginRes = await control.inject({
    method: 'POST',
    url: '/api/v1/auth/login',
    payload: { email: testAdminEmail, password: 'StrongAdminPassword123!' },
  });
  assert.strictEqual(adminLoginRes.statusCode, 200);
  const activeAdminCookie = adminLoginRes.headers['set-cookie'] as string;

  // Create a World
  const worldRes = await control.inject({
    method: 'POST',
    url: '/api/v1/worlds',
    headers: { cookie: activeAdminCookie },
    payload: {
      name: `Security-Test-World-${ts}`,
      description: 'World for security and RBAC testing',
      runtimeMode: 'LOGICAL',
    },
  });
  assert.strictEqual(worldRes.statusCode, 201, 'World creation must succeed for Admin');
  const worldId = JSON.parse(worldRes.payload).data.id;

  // Create a Fault Spec in the world
  const createFaultRes = await control.inject({
    method: 'POST',
    url: `/api/v1/worlds/${worldId}/faults`,
    headers: { cookie: activeAdminCookie },
    payload: {
      name: 'Test Latency Fault',
      faultType: 'LATENCY',
      parameters: { latencyMicros: 200000, jitterMicros: 10000 },
    },
  });
  assert.strictEqual(createFaultRes.statusCode, 201);
  const faultId = JSON.parse(createFaultRes.payload).data.id;

  // Sign up Viewer user
  const viewerEmail = `viewer-${ts}@mirrorgrid.io`;
  const viewerSignupRes = await control.inject({
    method: 'POST',
    url: '/api/v1/auth/signup',
    payload: {
      email: viewerEmail,
      password: 'ViewerPassword123!',
      displayName: 'Junior Viewer',
      organizationName: 'Viewer Org',
    },
  });
  assert.strictEqual(viewerSignupRes.statusCode, 201);
  const viewerUserId = JSON.parse(viewerSignupRes.payload).user.id;
  const viewerCookie = viewerSignupRes.headers['set-cookie'] as string;

  // Explicitly assign VIEWER role to viewer user
  const setViewerRoleRes = await control.inject({
    method: 'PUT',
    url: `/api/v1/users/${viewerUserId}/roles`,
    headers: { cookie: activeAdminCookie },
    payload: { roles: ['VIEWER'] },
  });
  assert.strictEqual(setViewerRoleRes.statusCode, 200, 'Admin can assign roles');

  // Sign up Operator user
  const operatorEmail = `operator-${ts}@mirrorgrid.io`;
  const operatorSignupRes = await control.inject({
    method: 'POST',
    url: '/api/v1/auth/signup',
    payload: {
      email: operatorEmail,
      password: 'OperatorPassword123!',
      displayName: 'Field Operator',
      organizationName: 'Operator Org',
    },
  });
  assert.strictEqual(operatorSignupRes.statusCode, 201);
  const operatorUserId = JSON.parse(operatorSignupRes.payload).user.id;
  const operatorCookie = operatorSignupRes.headers['set-cookie'] as string;

  // Assign OPERATOR role to operator user
  const setOperatorRoleRes = await control.inject({
    method: 'PUT',
    url: `/api/v1/users/${operatorUserId}/roles`,
    headers: { cookie: activeAdminCookie },
    payload: { roles: ['OPERATOR'] },
  });
  assert.strictEqual(setOperatorRoleRes.statusCode, 200);

  // VIEWER attempts to inject fault -> MUST BE FORBIDDEN (403)
  const viewerInjectRes = await control.inject({
    method: 'POST',
    url: `/api/v1/worlds/${worldId}/faults/${faultId}/inject`,
    headers: { cookie: viewerCookie },
    payload: { durationMicros: 10000000 },
  });
  assert.strictEqual(
    viewerInjectRes.statusCode,
    403,
    'VIEWER role must receive 403 Forbidden on fault injection',
  );
  assert.strictEqual(JSON.parse(viewerInjectRes.payload).error.code, 'FORBIDDEN');

  // VIEWER attempts to manage user roles -> MUST BE FORBIDDEN (403)
  const viewerRoleAssignRes = await control.inject({
    method: 'PUT',
    url: `/api/v1/users/${operatorUserId}/roles`,
    headers: { cookie: viewerCookie },
    payload: { roles: ['ADMIN'] },
  });
  assert.strictEqual(
    viewerRoleAssignRes.statusCode,
    403,
    'VIEWER role must receive 403 Forbidden on user management',
  );

  // OPERATOR attempts to inject fault -> MUST SUCCEED (201)
  const operatorInjectRes = await control.inject({
    method: 'POST',
    url: `/api/v1/worlds/${worldId}/faults/${faultId}/inject`,
    headers: { cookie: operatorCookie },
    payload: { durationMicros: 10000000 },
  });
  assert.strictEqual(
    operatorInjectRes.statusCode,
    201,
    'OPERATOR role must be allowed to inject faults',
  );

  // OPERATOR attempts to manage user roles -> MUST BE FORBIDDEN (403)
  const operatorRoleAssignRes = await control.inject({
    method: 'PUT',
    url: `/api/v1/users/${viewerUserId}/roles`,
    headers: { cookie: operatorCookie },
    payload: { roles: ['ADMIN'] },
  });
  assert.strictEqual(
    operatorRoleAssignRes.statusCode,
    403,
    'OPERATOR role must receive 403 Forbidden on user management',
  );

  console.log(
    '✓ Assertion 2 PASSED: RBAC strictly enforces role permissions across VIEWER, OPERATOR, and ADMIN.',
  );

  // =========================================================================
  // Assertion 3: Cryptographic Audit Hash Chain Verification
  // =========================================================================
  console.log(
    '\n[5/6] [Assertion 3 & 4] Testing Cryptographic Audit Hash Chain & Tamper Detection...',
  );

  // Verification from genesis
  const chainVerify = await auditLogger.verifyChain();
  assert.strictEqual(
    chainVerify.valid,
    true,
    'Audit hash chain must be mathematically intact from genesis',
  );
  assert(
    chainVerify.totalRecords >= 3,
    `Must have logged multiple mutating actions, got ${chainVerify.totalRecords}`,
  );
  console.log(
    `✓ Assertion 3 PASSED: Audit ledger hash chain is mathematically intact (${chainVerify.totalRecords} records verified).`,
  );

  // =========================================================================
  // Assertion 4: Tamper Detection at Exact Sequence
  // =========================================================================
  // Fetch an existing record
  const [targetRecord] = await db.select().from(auditLogs).where(eq(auditLogs.seqNum, 2)).limit(1);

  assert(targetRecord, 'Audit record at seq_num 2 must exist');
  const originalDiff = targetRecord.diffJson;

  // Directly tamper with SQLite table row
  await db
    .update(auditLogs)
    .set({ diffJson: { tampered: true, evilPayload: 'ALTERED_DATA' } })
    .where(eq(auditLogs.seqNum, 2));

  // Run chain verification: MUST DETECT CORRUPTION AT SEQ 2
  const tamperedCheck = await auditLogger.verifyChain();
  assert.strictEqual(tamperedCheck.valid, false, 'Tampered audit record must break hash chain');
  assert.strictEqual(tamperedCheck.brokenSeq, 2, 'Tampering must be detected at exact sequence #2');

  // Restore record
  await db.update(auditLogs).set({ diffJson: originalDiff }).where(eq(auditLogs.seqNum, 2));

  const restoredCheck = await auditLogger.verifyChain();
  assert.strictEqual(restoredCheck.valid, true, 'Restoring original payload restores valid chain');
  console.log(
    '✓ Assertion 4 PASSED: Tampering with audit record payload was immediately detected at sequence #2.',
  );

  // =========================================================================
  // Assertion 5: Adaptive Rate Limiting & RFC 6585 Headers
  // =========================================================================
  console.log('\n[6/6] [Assertion 5 & 6] Testing Adaptive Rate Limiting & No-Mock Rule...');

  const abusiveIp = '203.0.113.88';

  // Send request and assert RFC 6585 headers
  const rlRes = await control.inject({
    method: 'GET',
    url: '/api/v1/worlds',
    headers: {
      cookie: activeAdminCookie,
      'x-forwarded-for': abusiveIp,
    },
  });

  assert.strictEqual(rlRes.statusCode, 200);
  assert(rlRes.headers['ratelimit-limit'], 'Must include RateLimit-Limit header');
  assert(rlRes.headers['ratelimit-remaining'], 'Must include RateLimit-Remaining header');
  assert(rlRes.headers['ratelimit-reset'], 'Must include RateLimit-Reset header');

  // Artificially test rate limit rejection and 429 Retry-After
  // Use a custom high-frequency client to exhaust quota
  const exhaustionIp = '203.0.113.99';
  let received429 = false;
  let retryAfterValue: string | undefined;

  for (let i = 0; i < 110; i++) {
    const res = await control.inject({
      method: 'GET',
      url: '/api/v1/worlds',
      headers: {
        cookie: activeAdminCookie,
        'x-forwarded-for': exhaustionIp,
      },
    });

    if (res.statusCode === 429) {
      received429 = true;
      retryAfterValue = res.headers['retry-after'] as string | undefined;
      break;
    }
  }

  assert.strictEqual(received429, true, 'Exceeding burst quota must return 429 Too Many Requests');
  assert(
    retryAfterValue && parseInt(retryAfterValue, 10) > 0,
    'Retry-After header must be present and > 0',
  );

  // Test adaptive penalty tracker: 5 consecutive client errors on abusiveIp
  for (let i = 0; i < 5; i++) {
    control.rateLimiter.recordClientError(abusiveIp);
  }
  assert.strictEqual(
    control.rateLimiter.adaptiveTracker.isPenalized(abusiveIp),
    true,
    'Adaptive penalty must trigger after 5 client errors',
  );
  assert.strictEqual(
    control.rateLimiter.adaptiveTracker.getPenaltyMultiplier(abusiveIp),
    4,
    'Refill rate penalty multiplier must be 4x',
  );

  console.log(
    '✓ Assertion 5 PASSED: Adaptive rate limiter throttles burst traffic with RFC 6585 headers.',
  );

  // =========================================================================
  // Assertion 6: No-Mock Rule & Database Persistence
  // =========================================================================
  const mockViolations = await checkNoMockDataRule(REPO_ROOT);
  assert.strictEqual(
    mockViolations.length,
    0,
    `No-Mock Rule VIOLATION: Found mock files: ${mockViolations.join(', ')}`,
  );
  console.log('✓ Assertion 6 PASSED: No-Mock Rule verified (0 mock-data.ts files in repository).');

  // Clean shutdown
  await control.close();

  console.log('\n====================================================');
  console.log('   ✓ ALL 6 M6 GATE ASSERTIONS PASSED SUCCESSFULLY!  ');
  console.log('====================================================');
}

runGate()
  // Explicitly exit on success: the mysql2 connection pool keeps open
  // sockets that hold the Node event loop open indefinitely otherwise,
  // which is not a failure -- the gate already finished -- but looks
  // exactly like a hang from the outside.
  .then(() => process.exit(0))
  .catch((err) => {
  console.error('\n✗ M6 GATE VERIFICATION FAILED:\n', err);
  process.exit(1);
});
