import assert from 'node:assert';
import { runMigrations, db, eq } from '@mirrorgrid/db';
import { asyncJobs } from '@mirrorgrid/db/schema';
import { leaseManager } from '../../src/core/lease-manager.js';
import { WorkerPool } from '../../src/core/worker-pool.js';

export async function testWorkerPool() {
  console.log('Testing WorkerPool concurrent execution...');
  await runMigrations();

  const testQueue = `pool-q-${Date.now()}`;
  const pool = new WorkerPool({
    queues: [testQueue],
    concurrency: 2,
    pollIntervalMs: 20,
  });

  const executedJobs: string[] = [];
  pool.registerHandler('CALCULATE_SUM', async (job) => {
    executedJobs.push(job.id);
  });

  // Enqueue 5 jobs
  const jobIds: string[] = [];
  for (let i = 0; i < 5; i++) {
    const j = await leaseManager.enqueue(
      'CALCULATE_SUM',
      { index: i },
      {
        queueName: testQueue,
      },
    );
    jobIds.push(j.id);
  }

  // Start pool
  pool.start();

  // Wait for all 5 jobs to complete
  const start = Date.now();
  while (executedJobs.length < 5 && Date.now() - start < 5000) {
    await new Promise((r) => setTimeout(r, 50));
  }

  await pool.stop();

  assert.strictEqual(executedJobs.length, 5, 'All 5 jobs must be processed by WorkerPool');

  for (const id of jobIds) {
    const [j] = await db.select().from(asyncJobs).where(eq(asyncJobs.id, id));
    assert.strictEqual(j.status, 'COMPLETED');
  }

  console.log('✓ WorkerPool concurrency verified successfully.');
}
