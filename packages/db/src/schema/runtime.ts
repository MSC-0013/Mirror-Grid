import { mysqlTable, varchar, text, int, bigint, json, datetime, check, index } from 'drizzle-orm/mysql-core';
import { sql } from 'drizzle-orm';
import { worlds } from './core.js';
import { services } from './topology.js';

export const experimentRuns = mysqlTable(
  'experiment_runs',
  {
    id: varchar('id', { length: 36 })
      .primaryKey()
      .$defaultFn(() => crypto.randomUUID()),
    worldId: varchar('world_id', { length: 36 })
      .notNull()
      .references(() => worlds.id, { onDelete: 'cascade' }),
    seed: bigint('seed', { mode: 'bigint', unsigned: true }).notNull(),
    runtimeMode: varchar('runtime_mode', { length: 255 }).notNull().$type<'LOGICAL' | 'CONTAINER' | 'HYBRID'>(),
    engineVersion: varchar('engine_version', { length: 255 }).notNull(),
    schemaVersion: int('schema_version').notNull().default(1),
    gitCommit: varchar('git_commit', { length: 255 }),
    lockfileHash: varchar('lockfile_hash', { length: 64 }),
    frozenConfig: json('frozen_config').notNull(),
    configHash: text('config_hash').notNull(),
    finalStateHash: varchar('final_state_hash', { length: 64 }),
    status: varchar('status', { length: 255 })
      .notNull()
      .default('CREATED')
      .$type<'CREATED' | 'RUNNING' | 'COMPLETED' | 'FAILED' | 'CANCELLED'>(),
    experimentId: varchar('experiment_id', { length: 36 }),
    runNumber: int('run_number').notNull().default(1),
    currentPhase: varchar('current_phase', { length: 255 }).notNull().default('WARMUP'),
    mttdMicros: bigint('mttd_micros', { mode: 'bigint', unsigned: true }),
    mttrMicros: bigint('mttr_micros', { mode: 'bigint', unsigned: true }),
    peakErrorRatePpm: int('peak_error_rate_ppm').default(0),
    peakP99Micros: bigint('peak_p99_micros', { mode: 'bigint', unsigned: true }).default(0n),
    resultSummary: json('result_summary').$defaultFn(() => ({})),
    startedAt: datetime('started_at', { mode: 'date', fsp: 3 }),
    completedAt: datetime('completed_at', { mode: 'date', fsp: 3 }),
    createdAt: datetime('created_at', { mode: 'date', fsp: 3 })
      .notNull()
      .$defaultFn(() => new Date()),
  },
  (table) => [
    index('experiment_runs_world_idx').on(table.worldId, table.status),
    index('experiment_runs_created_idx').on(table.createdAt),
    check(
      'experiment_runs_mode_check',
      sql`${table.runtimeMode} IN ('LOGICAL','CONTAINER','HYBRID')`,
    ),
    check(
      'experiment_runs_status_check',
      sql`${table.status} IN ('CREATED','RUNNING','COMPLETED','FAILED','CANCELLED')`,
    ),
  ],
);

export const experimentMetrics = mysqlTable(
  'experiment_metrics',
  {
    id: int('id').autoincrement().primaryKey(),
    runId: varchar('run_id', { length: 36 })
      .notNull()
      .references(() => experimentRuns.id, { onDelete: 'cascade' }),
    serviceId: varchar('service_id', { length: 36 })
      .notNull()
      .references(() => services.id, { onDelete: 'cascade' }),
    virtualTimeUs: bigint('virtual_time_us', { mode: 'bigint', unsigned: true }).notNull(),
    wallTimeMs: bigint('wall_time_ms', { mode: 'bigint', unsigned: true }).notNull(),
    requestsTotal: int('requests_total').notNull().default(0),
    requestsFailed: int('requests_failed').notNull().default(0),
    queueDepth: int('queue_depth').notNull().default(0),
    activeSlots: int('active_slots').notNull().default(0),
    circuitState: varchar('circuit_state', { length: 255 }).$type<'CLOSED' | 'OPEN' | 'HALF_OPEN'>(),
    latencySamplesUs: json('latency_samples_us').$type<number[]>(),
    latencyHistogram: json('latency_histogram').$type<number[]>(),
  },
  (table) => [
    index('experiment_metrics_run_service_time_idx').on(
      table.runId,
      table.serviceId,
      table.virtualTimeUs,
    ),
    check(
      'experiment_metrics_circuit_state_check',
      sql`${table.circuitState} IS NULL OR ${table.circuitState} IN ('CLOSED','OPEN','HALF_OPEN')`,
    ),
  ],
);

export type ExperimentRun = typeof experimentRuns.$inferSelect;
export type NewExperimentRun = typeof experimentRuns.$inferInsert;
export type ExperimentMetric = typeof experimentMetrics.$inferSelect;
export type NewExperimentMetric = typeof experimentMetrics.$inferInsert;
