import { sqliteTable, text, integer, index } from 'drizzle-orm/sqlite-core';
import { relations } from 'drizzle-orm';

export const asyncJobs = sqliteTable(
  'async_jobs',
  {
    id: text('id')
      .primaryKey()
      .$defaultFn(() => crypto.randomUUID()),
    queueName: text('queue_name').notNull().default('default'),
    jobType: text('job_type').notNull(),
    payload: text('payload', { mode: 'json' })
      .$type<Record<string, unknown>>()
      .notNull()
      .$defaultFn(() => ({})),
    status: text('status', {
      enum: ['PENDING', 'RUNNING', 'COMPLETED', 'FAILED', 'DEAD_LETTER', 'CANCELLED'],
    })
      .notNull()
      .default('PENDING'),
    priority: integer('priority').notNull().default(100),
    attempts: integer('attempts').notNull().default(0),
    maxAttempts: integer('max_attempts').notNull().default(5),
    leaseOwner: text('lease_owner'),
    leaseExpiresAt: integer('lease_expires_at', { mode: 'timestamp_ms' }),
    runAt: integer('run_at', { mode: 'timestamp_ms' })
      .notNull()
      .$defaultFn(() => new Date()),
    lastError: text('last_error'),
    createdAt: integer('created_at', { mode: 'timestamp_ms' })
      .notNull()
      .$defaultFn(() => new Date()),
    updatedAt: integer('updated_at', { mode: 'timestamp_ms' })
      .notNull()
      .$defaultFn(() => new Date()),
  },
  (table) => [
    index('idx_jobs_claim').on(table.queueName, table.status, table.runAt, table.priority),
    index('idx_jobs_lease').on(table.leaseOwner, table.leaseExpiresAt),
  ],
);

export const deadLetterQueue = sqliteTable(
  'dead_letter_queue',
  {
    id: text('id')
      .primaryKey()
      .$defaultFn(() => crypto.randomUUID()),
    originalJobId: text('original_job_id')
      .notNull()
      .references(() => asyncJobs.id, { onDelete: 'cascade' }),
    queueName: text('queue_name').notNull(),
    jobType: text('job_type').notNull(),
    payload: text('payload', { mode: 'json' }).$type<Record<string, unknown>>().notNull(),
    failedReason: text('failed_reason').notNull(),
    stackTrace: text('stack_trace'),
    exhaustedAttempts: integer('exhausted_attempts').notNull(),
    deadLetteredAt: integer('dead_lettered_at', { mode: 'timestamp_ms' })
      .notNull()
      .$defaultFn(() => new Date()),
  },
  (table) => [index('idx_dlq_queue').on(table.queueName, table.deadLetteredAt)],
);

export const workerNodes = sqliteTable(
  'worker_nodes',
  {
    id: text('id').primaryKey(),
    hostname: text('hostname').notNull(),
    pid: integer('pid').notNull(),
    activeQueues: text('active_queues', { mode: 'json' })
      .$type<string[]>()
      .notNull()
      .$defaultFn(() => []),
    concurrency: integer('concurrency').notNull().default(4),
    lastHeartbeat: integer('last_heartbeat', { mode: 'timestamp_ms' })
      .notNull()
      .$defaultFn(() => new Date()),
    status: text('status', {
      enum: ['ALIVE', 'DRAINING', 'DEAD'],
    })
      .notNull()
      .default('ALIVE'),
    startedAt: integer('started_at', { mode: 'timestamp_ms' })
      .notNull()
      .$defaultFn(() => new Date()),
  },
  (table) => [index('idx_workers_heartbeat').on(table.status, table.lastHeartbeat)],
);

export const asyncJobsRelations = relations(asyncJobs, ({ many }) => ({
  deadLetters: many(deadLetterQueue),
}));

export const deadLetterQueueRelations = relations(deadLetterQueue, ({ one }) => ({
  originalJob: one(asyncJobs, {
    fields: [deadLetterQueue.originalJobId],
    references: [asyncJobs.id],
  }),
}));
