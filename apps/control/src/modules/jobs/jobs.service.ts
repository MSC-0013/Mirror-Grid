import { eq, desc, count } from 'drizzle-orm';
import { db } from '@mirrorgrid/db';
import { deadLetterQueue } from '@mirrorgrid/db/schema';
import { leaseManager, type EnqueueOptions } from '@mirrorgrid/jobs';
import { auditLogger, type UserPrincipal } from '@mirrorgrid/security';

export interface DeadLetterQueryOptions {
  queueName?: string;
  page?: number;
  limit?: number;
}

export class JobsService {
  public async getQueueStats() {
    return leaseManager.getQueueStats();
  }

  public async listDeadLetters(options: DeadLetterQueryOptions = {}) {
    const page = Math.max(1, options.page ?? 1);
    const limit = Math.min(100, Math.max(1, options.limit ?? 50));
    const offset = (page - 1) * limit;

    const whereClause = options.queueName
      ? eq(deadLetterQueue.queueName, options.queueName)
      : undefined;

    const [totalRow] = await db.select({ count: count() }).from(deadLetterQueue).where(whereClause);

    const total = totalRow ? Number(totalRow.count) : 0;

    const items = await db
      .select()
      .from(deadLetterQueue)
      .where(whereClause)
      .orderBy(desc(deadLetterQueue.deadLetteredAt))
      .limit(limit)
      .offset(offset);

    return {
      data: items,
      pagination: {
        page,
        limit,
        total,
        totalPages: Math.ceil(total / limit),
      },
    };
  }

  public async enqueue(
    jobType: string,
    payload: Record<string, unknown>,
    options?: EnqueueOptions,
    principal?: UserPrincipal,
  ) {
    const job = await leaseManager.enqueue(jobType, payload, options);

    void auditLogger.log({
      principal: principal ?? undefined,
      action: 'JOB_ENQUEUED',
      resourceType: 'JOB',
      resourceId: job.id,
      diff: {
        queueName: job.queueName,
        jobType: job.jobType,
      },
    });

    return job;
  }

  public async redrive(jobId: string, principal?: UserPrincipal) {
    const job = await leaseManager.redriveJob(jobId);

    void auditLogger.log({
      principal: principal ?? undefined,
      action: 'JOB_REDRIVEN',
      resourceType: 'JOB',
      resourceId: jobId,
      diff: {
        queueName: job.queueName,
        jobType: job.jobType,
      },
    });

    return job;
  }
}

export const jobsService = new JobsService();
