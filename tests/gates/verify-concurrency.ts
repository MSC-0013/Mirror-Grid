/**
 * M7 Verification Gate Script: tests/gates/verify-concurrency.ts
 *
 * Enforces the M07 concurrency and async platform verification assertions:
 * 1. Mutual Exclusion & Zero Duplicate Claims under concurrent worker contention
 * 2. Lease Expiry & Orphan Job Recovery
 * 3. Poison Pill & Dead-Letter Queue (DLQ) Transition
 * 4. DLQ Redrive restores job to PENDING and enables clean completion
 * 5. High-Throughput Concurrent Processing (500 jobs across queues with zero deadlocks)
 * 6. Zero-Mock Rule Compliance
 */

import assert from 'node:assert';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { runMigrations, db, eq } from '../../packages/db/src/index.js';
import { asyncJobs, deadLetterQueue } from '../../packages/db/src/schema/jobs.js';
import { leaseManager, WorkerPool } from '../../packages/jobs/src/index.js';

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
  console.log('   MIRRORGRID M7: Async Platform & Concurrency Gate  ');
  console.log('====================================================\n');

  // 1. Ensure migrations are applied
  console.log('[1/6] Applying database migrations for async platform...');
  await runMigrations();
  console.log('✓ SQLite database migrations up to date (including 008_async_platform.sql).');

  // =========================================================================
  // Assertion 1: Mutual Exclusion & Zero Duplicate Claims
  // =========================================================================
  console.log('\n[2/6] [Assertion 1] Testing Mutual Exclusion across 10 concurrent workers...');
  const exclusiveQueue = `excl-q-${Date.now()}`;
  const soloJob = await leaseManager.enqueue(
    'EXCLUSIVE_TASK',
    { data: 42 },
    {
      queueName: exclusiveQueue,
    },
  );

  // Launch 10 simultaneous claim requests
  const claimPromises = Array.from({ length: 10 }).map((_, i) =>
    leaseManager.claimJob({
      workerId: `contender-worker-${i}`,
      queues: [exclusiveQueue],
    }),
  );

  const claimResults = await Promise.all(claimPromises);
  const successfulClaims = claimResults.filter((res) => res !== null);

  assert.strictEqual(
    successfulClaims.length,
    1,
    `Exactly 1 worker must acquire lease, received ${successfulClaims.length}`,
  );
  assert.strictEqual(
    successfulClaims[0]!.id,
    soloJob.id,
    'Claimed job ID must match enqueued job ID',
  );
  console.log(
    `✓ Assertion 1 PASSED: Exactly 1 out of 10 workers won lease (${successfulClaims[0]!.leaseOwner}); 9 rejected.`,
  );

  // Complete the job cleanly
  await leaseManager.completeJob(soloJob.id, successfulClaims[0]!.leaseOwner!);

  // =========================================================================
  // Assertion 2: Lease Expiry & Orphan Job Recovery
  // =========================================================================
  console.log('\n[3/6] [Assertion 2] Testing Lease Expiration and Orphan Recovery...');
  const orphanQueue = `orphan-q-${Date.now()}`;
  const orphanJob = await leaseManager.enqueue(
    'ORPHAN_TASK',
    { payload: 'recover-me' },
    {
      queueName: orphanQueue,
    },
  );

  // Worker A claims with a tiny 50ms lease, then "dies"
  const claimA = await leaseManager.claimJob({
    workerId: 'doomed-worker-A',
    queues: [orphanQueue],
    leaseDurationMs: 50,
  });
  assert(claimA, 'Worker A must claim orphan job');
  assert.strictEqual(claimA.leaseOwner, 'doomed-worker-A');

  // Immediate claim by Worker B before lease expires MUST fail
  const claimBImmediate = await leaseManager.claimJob({
    workerId: 'survivor-worker-B',
    queues: [orphanQueue],
  });
  assert.strictEqual(claimBImmediate, null, 'Active lease must not be stolen before expiry');

  // Wait 70ms for lease to expire
  await new Promise((r) => setTimeout(r, 70));

  // Worker B claims after lease expiration -> MUST SUCCEED (reclaimed orphan)
  const claimBReclaimed = await leaseManager.claimJob({
    workerId: 'survivor-worker-B',
    queues: [orphanQueue],
  });
  assert(claimBReclaimed, 'Worker B must reclaim expired orphan job');
  assert.strictEqual(claimBReclaimed.id, orphanJob.id);
  assert.strictEqual(claimBReclaimed.leaseOwner, 'survivor-worker-B');
  assert.strictEqual(claimBReclaimed.attempts, 2, 'Attempts counter must be 2');

  await leaseManager.completeJob(orphanJob.id, 'survivor-worker-B');
  console.log(
    '✓ Assertion 2 PASSED: Orphaned job reclaimed by survivor worker after lease expired.',
  );

  // =========================================================================
  // Assertion 3: Poison Pill & Dead-Letter Queue (DLQ) Transition
  // =========================================================================
  console.log('\n[4/6] [Assertion 3] Testing Poison Pill & Dead-Letter Queue Transition...');
  const dlqQueue = `poison-q-${Date.now()}`;
  const poisonJob = await leaseManager.enqueue(
    'POISON_PILL',
    { dangerous: true },
    {
      queueName: dlqQueue,
      maxAttempts: 3,
    },
  );

  // Attempt 1: fail
  const c1 = await leaseManager.claimJob({ workerId: 'w-poison', queues: [dlqQueue] });
  assert(c1);
  const fail1 = await leaseManager.failJob(c1.id, 'w-poison', 'Transient fault attempt 1');
  assert.strictEqual(fail1.deadLettered, false);

  // Force runAt to past to bypass backoff
  await db
    .update(asyncJobs)
    .set({ runAt: new Date(Date.now() - 1000) })
    .where(eq(asyncJobs.id, poisonJob.id));

  // Attempt 2: fail
  const c2 = await leaseManager.claimJob({ workerId: 'w-poison', queues: [dlqQueue] });
  assert(c2);
  const fail2 = await leaseManager.failJob(c2.id, 'w-poison', 'Transient fault attempt 2');
  assert.strictEqual(fail2.deadLettered, false);

  await db
    .update(asyncJobs)
    .set({ runAt: new Date(Date.now() - 1000) })
    .where(eq(asyncJobs.id, poisonJob.id));

  // Attempt 3: fatal failure -> reaches maxAttempts (3) -> DEAD_LETTER
  const c3 = await leaseManager.claimJob({ workerId: 'w-poison', queues: [dlqQueue] });
  assert(c3);
  const fail3 = await leaseManager.failJob(c3.id, 'w-poison', 'Fatal unrecoverable error');
  assert.strictEqual(fail3.deadLettered, true, 'Job must be marked deadLettered on 3rd failure');

  // Verify DB state
  const [dbJob] = await db.select().from(asyncJobs).where(eq(asyncJobs.id, poisonJob.id));
  assert.strictEqual(dbJob.status, 'DEAD_LETTER');

  const [dlqEntry] = await db
    .select()
    .from(deadLetterQueue)
    .where(eq(deadLetterQueue.originalJobId, poisonJob.id));
  assert(dlqEntry, 'Must have record in dead_letter_queue table');
  assert.strictEqual(dlqEntry.exhaustedAttempts, 3);
  assert.strictEqual(dlqEntry.failedReason, 'Fatal unrecoverable error');
  console.log(
    '✓ Assertion 3 PASSED: Poison pill transitioned to DEAD_LETTER after 3 failed attempts.',
  );

  // =========================================================================
  // Assertion 4: DLQ Redrive
  // =========================================================================
  console.log('\n[5/6] [Assertion 4] Testing DLQ Redrive and Completion...');
  const redriven = await leaseManager.redriveJob(poisonJob.id);
  assert.strictEqual(redriven.status, 'PENDING');
  assert.strictEqual(redriven.attempts, 0);

  const [dlqCheck] = await db
    .select()
    .from(deadLetterQueue)
    .where(eq(deadLetterQueue.originalJobId, poisonJob.id));
  assert.strictEqual(dlqCheck, undefined, 'DLQ record must be purged upon redrive');

  const claimRedriven = await leaseManager.claimJob({ workerId: 'w-rescue', queues: [dlqQueue] });
  assert(claimRedriven, 'Redriven job must be claimable');
  await leaseManager.completeJob(claimRedriven.id, 'w-rescue');

  const [completedJob] = await db.select().from(asyncJobs).where(eq(asyncJobs.id, poisonJob.id));
  assert.strictEqual(completedJob.status, 'COMPLETED');
  console.log('✓ Assertion 4 PASSED: Redrive cleanly restored job to PENDING and completed.');

  // =========================================================================
  // Assertion 5: High-Throughput Concurrent Processing
  // =========================================================================
  console.log(
    '\n[6/6] [Assertion 5 & 6] Testing High-Throughput Concurrent Processing (500 jobs) & No-Mock Rule...',
  );
  const qA = `sim-ticks-${Date.now()}`;
  const qB = `metrics-rollup-${Date.now()}`;
  const qC = `reports-${Date.now()}`;
  const testQueues = [qA, qB, qC];

  const pool = new WorkerPool({
    queues: testQueues,
    concurrency: 8,
    pollIntervalMs: 10,
    leaseDurationMs: 10000,
  });

  const processedJobIds = new Set<string>();
  pool.registerHandler('BENCHMARK_TASK', async (job) => {
    processedJobIds.add(job.id);
  });

  // Enqueue 500 jobs across the 3 queues
  const TOTAL_JOBS = 500;
  const enqueuePromises = [];
  for (let i = 0; i < TOTAL_JOBS; i++) {
    const queue = testQueues[i % testQueues.length];
    enqueuePromises.push(
      leaseManager.enqueue('BENCHMARK_TASK', { index: i }, { queueName: queue }),
    );
  }
  const enqueuedJobs = await Promise.all(enqueuePromises);
  assert.strictEqual(enqueuedJobs.length, TOTAL_JOBS);

  // Start concurrent worker pool
  const startTime = Date.now();
  pool.start();

  // Wait until all 500 are processed (or timeout at 20s)
  while (processedJobIds.size < TOTAL_JOBS && Date.now() - startTime < 20000) {
    await new Promise((r) => setTimeout(r, 50));
  }

  await pool.stop();
  const elapsed = Date.now() - startTime;

  assert.strictEqual(
    processedJobIds.size,
    TOTAL_JOBS,
    `All ${TOTAL_JOBS} jobs must be processed, processed ${processedJobIds.size}`,
  );
  console.log(
    `✓ Assertion 5 PASSED: 500 jobs processed across 3 queues by 8 concurrent workers in ${elapsed}ms (${(TOTAL_JOBS / (elapsed / 1000)).toFixed(1)} jobs/s).`,
  );

  // Assertion 6: No-Mock Rule
  const mockViolations = await checkNoMockDataRule(REPO_ROOT);
  assert.strictEqual(
    mockViolations.length,
    0,
    `No-Mock Rule VIOLATION: Found mock files: ${mockViolations.join(', ')}`,
  );
  console.log('✓ Assertion 6 PASSED: Zero mock files detected across repository.');

  console.log('\n====================================================');
  console.log('   ✓ ALL 6 M7 GATE ASSERTIONS PASSED SUCCESSFULLY!  ');
  console.log('====================================================');
}

runGate().catch((err) => {
  console.error('\n✗ M7 GATE VERIFICATION FAILED:\n', err);
  process.exit(1);
});
