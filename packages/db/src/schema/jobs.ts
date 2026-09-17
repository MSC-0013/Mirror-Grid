import { mysqlTable, varchar, text, int, json, datetime, index } from 'drizzle-orm/mysql-core';
import { relations } from 'drizzle-orm';

export const asyncJobs = mysqlTable(
  'async_jobs',
  {
    id: varchar('id', { length: 36 })
      .primaryKey()
      .$defaultFn(() => crypto.randomUUID()),
    queueName: varchar('queue_name', { length: 255 }).notNull().default('default'),
    jobType: varchar('job_type', { length: 255 }).notNull(),
    payload: json('payload')
      .$type<Record<string, unknown>>()
      .notNull()
      .$defaultFn(() => ({})),
    status: varchar('status', { length: 64, enum: ['PENDING', 'RUNNING', 'COMPLETED', 'FAILED', 'DEAD_LETTER', 'CANCELLED'] })
      .notNull()
      .default('PENDING'),
    priority: int('priority').notNull().default(100),
    attempts: int('attempts').notNull().default(0),
    maxAttempts: int('max_attempts').notNull().default(5),
    leaseOwner: varchar('lease_owner', { length: 255 }),
    leaseExpiresAt: datetime('lease_expires_at', { mode: 'date', fsp: 3 }),
    runAt: datetime('run_at', { mode: 'date', fsp: 3 })
      .notNull()
      .$defaultFn(() => new Date()),
    lastError: text('last_error'),
    createdAt: datetime('created_at', { mode: 'date', fsp: 3 })
      .notNull()
      .$defaultFn(() => new Date()),
    updatedAt: datetime('updated_at', { mode: 'date', fsp: 3 })
      .notNull()
      .$defaultFn(() => new Date()),
  },
  (table) => [
    index('idx_jobs_claim').on(table.queueName, table.status, table.runAt, table.priority),
    index('idx_jobs_lease').on(table.leaseOwner, table.leaseExpiresAt),
  ],
);

export const deadLetterQueue = mysqlTable(
  'dead_letter_queue',
  {
    id: varchar('id', { length: 36 })
      .primaryKey()
      .$defaultFn(() => crypto.randomUUID()),
    originalJobId: varchar('original_job_id', { length: 36 })
      .notNull()
      .references(() => asyncJobs.id, { onDelete: 'cascade' }),
    queueName: varchar('queue_name', { length: 255 }).notNull(),
    jobType: varchar('job_type', { length: 255 }).notNull(),
    payload: json('payload').$type<Record<string, unknown>>().notNull(),
    failedReason: text('failed_reason').notNull(),
    stackTrace: text('stack_trace'),
    exhaustedAttempts: int('exhausted_attempts').notNull(),
    deadLetteredAt: datetime('dead_lettered_at', { mode: 'date', fsp: 3 })
      .notNull()
      .$defaultFn(() => new Date()),
  },
  (table) => [index('idx_dlq_queue').on(table.queueName, table.deadLetteredAt)],
);

export const workerNodes = mysqlTable(
  'worker_nodes',
  {
    id: varchar('id', { length: 36 }).primaryKey(),
    hostname: varchar('hostname', { length: 255 }).notNull(),
    pid: int('pid').notNull(),
    activeQueues: json('active_queues')
      .$type<string[]>()
      .notNull()
      .$defaultFn(() => []),
    concurrency: int('concurrency').notNull().default(4),
    lastHeartbeat: datetime('last_heartbeat', { mode: 'date', fsp: 3 })
      .notNull()
      .$defaultFn(() => new Date()),
    status: varchar('status', { length: 64, enum: ['ALIVE', 'DRAINING', 'DEAD'] })
      .notNull()
      .default('ALIVE'),
    startedAt: datetime('started_at', { mode: 'date', fsp: 3 })
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
