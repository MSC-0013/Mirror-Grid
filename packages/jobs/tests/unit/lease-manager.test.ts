import assert from 'node:assert';
import { runMigrations, db, eq } from '@mirrorgrid/db';
import { asyncJobs, deadLetterQueue } from '@mirrorgrid/db/schema';
import { leaseManager } from '../../src/core/lease-manager.js';

export async function testLeaseManager() {
  console.log('Testing LeaseManager atomic lifecycle & DLQ...');
  await runMigrations();

  const testQueue = `test-q-${Date.now()}`;

  // 1. Enqueue
  const job = await leaseManager.enqueue(
    'TEST_ACTION',
    { foo: 'bar' },
    {
      queueName: testQueue,
      maxAttempts: 2,
    },
  );
  assert.strictEqual(job.status, 'PENDING');
  assert.strictEqual(job.attempts, 0);

  // 2. Claim
  const claimed = await leaseManager.claimJob({
    workerId: 'worker-unit-01',
    queues: [testQueue],
  });
  assert(claimed, 'Job must be claimed');
  assert.strictEqual(claimed.id, job.id);
  assert.strictEqual(claimed.status, 'RUNNING');
  assert.strictEqual(claimed.leaseOwner, 'worker-unit-01');
  assert.strictEqual(claimed.attempts, 1);

  // 3. Fail attempt 1 -> backoff to PENDING
  const fail1 = await leaseManager.failJob(claimed.id, 'worker-unit-01', 'First transient error');
  assert.strictEqual(fail1.deadLettered, false, 'First attempt must not be dead-lettered');

  const [afterFail1] = await db.select().from(asyncJobs).where(eq(asyncJobs.id, job.id));
  assert.strictEqual(afterFail1.status, 'PENDING');
  assert.strictEqual(afterFail1.attempts, 1);

  // Manually force runAt to now to bypass backoff delay
  await db
    .update(asyncJobs)
    .set({ runAt: new Date(Date.now() - 1000) })
    .where(eq(asyncJobs.id, job.id));

  // 4. Claim attempt 2
  const claimed2 = await leaseManager.claimJob({
    workerId: 'worker-unit-02',
    queues: [testQueue],
  });
  assert(claimed2, 'Second claim must succeed');
  assert.strictEqual(claimed2.attempts, 2);

  // 5. Fail attempt 2 -> reaches maxAttempts (2) -> transitions to DEAD_LETTER
  const fail2 = await leaseManager.failJob(
    claimed2.id,
    'worker-unit-02',
    'Fatal poison pill error',
  );
  assert.strictEqual(fail2.deadLettered, true, 'Second attempt must be dead-lettered');

  const [afterFail2] = await db.select().from(asyncJobs).where(eq(asyncJobs.id, job.id));
  assert.strictEqual(afterFail2.status, 'DEAD_LETTER');

  const [dlqEntry] = await db
    .select()
    .from(deadLetterQueue)
    .where(eq(deadLetterQueue.originalJobId, job.id));
  assert(dlqEntry, 'Must create entry in dead_letter_queue table');
  assert.strictEqual(dlqEntry.failedReason, 'Fatal poison pill error');
  assert.strictEqual(dlqEntry.exhaustedAttempts, 2);

  // 6. Redrive
  const redriven = await leaseManager.redriveJob(job.id);
  assert.strictEqual(redriven.status, 'PENDING');
  assert.strictEqual(redriven.attempts, 0);

  const [dlqCheck] = await db
    .select()
    .from(deadLetterQueue)
    .where(eq(deadLetterQueue.originalJobId, job.id));
  assert(!dlqCheck, 'DLQ entry must be deleted on redrive');

  // 7. Claim and Complete
  const claimed3 = await leaseManager.claimJob({
    workerId: 'worker-unit-03',
    queues: [testQueue],
  });
  assert(claimed3);
  await leaseManager.completeJob(claimed3.id, 'worker-unit-03');

  const [finalJob] = await db.select().from(asyncJobs).where(eq(asyncJobs.id, job.id));
  assert.strictEqual(finalJob.status, 'COMPLETED');
  assert.strictEqual(finalJob.leaseOwner, null);

  console.log('✓ LeaseManager atomic lifecycle & DLQ verified successfully.');
}
