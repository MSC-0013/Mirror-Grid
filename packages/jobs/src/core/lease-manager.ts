import { eq, and, or, lte, lt, inArray, asc } from 'drizzle-orm';
import { db } from '@mirrorgrid/db';
import { asyncJobs, deadLetterQueue } from '@mirrorgrid/db/schema';
import type { JobDefinition, EnqueueOptions, ClaimOptions } from './types.js';

export class LeaseManager {
  private claimMutex: Promise<void> = Promise.resolve();

  public async enqueue(
    jobType: string,
    payload: Record<string, unknown> = {},
    options: EnqueueOptions = {},
  ): Promise<JobDefinition> {
    const runAt = new Date(Date.now() + (options.delayMs ?? 0));
    const [inserted] = await db
      .insert(asyncJobs)
      .values({
        jobType,
        payload,
        queueName: options.queueName ?? 'default',
        priority: options.priority ?? 100,
        maxAttempts: options.maxAttempts ?? 5,
        runAt,
        status: 'PENDING',
      })
      .returning();

    return inserted as JobDefinition;
  }

  public async claimJob(options: ClaimOptions): Promise<JobDefinition | null> {
    let releaseMutex: () => void = () => {};
    const waitPromise = new Promise<void>((resolve) => {
      releaseMutex = resolve;
    });
    const currentMutex = this.claimMutex;
    this.claimMutex = this.claimMutex.then(() => waitPromise);

    await currentMutex;

    try {
      const now = new Date();
      const leaseDurationMs = options.leaseDurationMs ?? 30000;
      const leaseExpiresAt = new Date(now.getTime() + leaseDurationMs);

      const queueCondition =
        options.queues && options.queues.length > 0
          ? inArray(asyncJobs.queueName, options.queues)
          : undefined;

      const eligibilityCondition = and(
        queueCondition,
        lte(asyncJobs.runAt, now),
        or(
          eq(asyncJobs.status, 'PENDING'),
          and(eq(asyncJobs.status, 'RUNNING'), lt(asyncJobs.leaseExpiresAt, now)),
        ),
      );

      const [candidate] = await db
        .select()
        .from(asyncJobs)
        .where(eligibilityCondition)
        .orderBy(asc(asyncJobs.priority), asc(asyncJobs.runAt))
        .limit(1);

      if (!candidate) {
        return null;
      }

      const [claimed] = await db
        .update(asyncJobs)
        .set({
          status: 'RUNNING',
          leaseOwner: options.workerId,
          leaseExpiresAt,
          attempts: candidate.attempts + 1,
          updatedAt: now,
        })
        .where(
          and(
            eq(asyncJobs.id, candidate.id),
            or(
              eq(asyncJobs.status, 'PENDING'),
              and(eq(asyncJobs.status, 'RUNNING'), lt(asyncJobs.leaseExpiresAt, now)),
            ),
          ),
        )
        .returning();

      return (claimed as JobDefinition) ?? null;
    } finally {
      releaseMutex();
    }
  }

  public async renewLease(jobId: string, workerId: string, durationMs = 30000): Promise<boolean> {
    const now = new Date();
    const newExpiresAt = new Date(now.getTime() + durationMs);

    const [updated] = await db
      .update(asyncJobs)
      .set({
        leaseExpiresAt: newExpiresAt,
        updatedAt: now,
      })
      .where(
        and(
          eq(asyncJobs.id, jobId),
          eq(asyncJobs.leaseOwner, workerId),
          eq(asyncJobs.status, 'RUNNING'),
        ),
      )
      .returning();

    return !!updated;
  }

  public async completeJob(jobId: string, workerId: string): Promise<void> {
    const now = new Date();
    await db
      .update(asyncJobs)
      .set({
        status: 'COMPLETED',
        leaseOwner: null,
        leaseExpiresAt: null,
        updatedAt: now,
      })
      .where(and(eq(asyncJobs.id, jobId), eq(asyncJobs.leaseOwner, workerId)));
  }

  public async failJob(
    jobId: string,
    _workerId: string,
    error: Error | string,
  ): Promise<{ deadLettered: boolean }> {
    const now = new Date();
    const errorMessage = typeof error === 'string' ? error : error.message;
    const stackTrace = typeof error === 'string' ? null : (error.stack ?? null);

    const [job] = await db.select().from(asyncJobs).where(eq(asyncJobs.id, jobId)).limit(1);

    if (!job) {
      return { deadLettered: false };
    }

    if (job.attempts >= job.maxAttempts) {
      await db.insert(deadLetterQueue).values({
        originalJobId: job.id,
        queueName: job.queueName,
        jobType: job.jobType,
        payload: job.payload,
        failedReason: errorMessage,
        stackTrace,
        exhaustedAttempts: job.attempts,
        deadLetteredAt: now,
      });

      await db
        .update(asyncJobs)
        .set({
          status: 'DEAD_LETTER',
          lastError: errorMessage,
          leaseOwner: null,
          leaseExpiresAt: null,
          updatedAt: now,
        })
        .where(eq(asyncJobs.id, jobId));

      return { deadLettered: true };
    } else {
      const baseDelay = 1000 * Math.pow(2, Math.max(0, job.attempts - 1));
      const jitter = Math.floor(Math.random() * 500);
      const backoffMs = Math.min(60000, baseDelay) + jitter;
      const nextRunAt = new Date(now.getTime() + backoffMs);

      await db
        .update(asyncJobs)
        .set({
          status: 'PENDING',
          runAt: nextRunAt,
          lastError: errorMessage,
          leaseOwner: null,
          leaseExpiresAt: null,
          updatedAt: now,
        })
        .where(eq(asyncJobs.id, jobId));

      return { deadLettered: false };
    }
  }

  public async redriveJob(jobId: string): Promise<JobDefinition> {
    const now = new Date();

    await db.delete(deadLetterQueue).where(eq(deadLetterQueue.originalJobId, jobId));

    const [updated] = await db
      .update(asyncJobs)
      .set({
        status: 'PENDING',
        attempts: 0,
        runAt: now,
        leaseOwner: null,
        leaseExpiresAt: null,
        lastError: null,
        updatedAt: now,
      })
      .where(eq(asyncJobs.id, jobId))
      .returning();

    return updated as JobDefinition;
  }

  public async getQueueStats(): Promise<Record<string, Record<string, number>>> {
    const jobs = await db.select().from(asyncJobs);
    const stats: Record<string, Record<string, number>> = {};

    for (const j of jobs) {
      if (!stats[j.queueName]) {
        stats[j.queueName] = {
          PENDING: 0,
          RUNNING: 0,
          COMPLETED: 0,
          FAILED: 0,
          DEAD_LETTER: 0,
          CANCELLED: 0,
        };
      }
      stats[j.queueName][j.status] = (stats[j.queueName][j.status] ?? 0) + 1;
    }

    return stats;
  }
}

export const leaseManager = new LeaseManager();
