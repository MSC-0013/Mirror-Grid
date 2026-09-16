import { sqliteTable, text, integer, blob, index, check } from 'drizzle-orm/sqlite-core';
import { sql } from 'drizzle-orm';
import { worlds } from './core.js';
import { services } from './topology.js';

export const experimentRuns = sqliteTable(
  'experiment_runs',
  {
    id: text('id')
      .primaryKey()
      .$defaultFn(() => crypto.randomUUID()),
    worldId: text('world_id')
      .notNull()
      .references(() => worlds.id, { onDelete: 'cascade' }),
    seed: blob('seed', { mode: 'bigint' }).notNull(),
    runtimeMode: text('runtime_mode').notNull().$type<'LOGICAL' | 'CONTAINER' | 'HYBRID'>(),
    engineVersion: text('engine_version').notNull(),
    schemaVersion: integer('schema_version').notNull().default(1),
    gitCommit: text('git_commit'),
    lockfileHash: text('lockfile_hash'),
    frozenConfig: text('frozen_config', { mode: 'json' }).notNull(),
    configHash: text('config_hash').notNull(),
    finalStateHash: text('final_state_hash'),
    status: text('status')
      .notNull()
      .default('CREATED')
      .$type<'CREATED' | 'RUNNING' | 'COMPLETED' | 'FAILED' | 'CANCELLED'>(),
    experimentId: text('experiment_id'),
    runNumber: integer('run_number').notNull().default(1),
    currentPhase: text('current_phase').notNull().default('WARMUP'),
    mttdMicros: blob('mttd_micros', { mode: 'bigint' }),
    mttrMicros: blob('mttr_micros', { mode: 'bigint' }),
    peakErrorRatePpm: integer('peak_error_rate_ppm').default(0),
    peakP99Micros: blob('peak_p99_micros', { mode: 'bigint' }).default(0n),
    resultSummary: text('result_summary', { mode: 'json' }).$defaultFn(() => ({})),
    startedAt: integer('started_at', { mode: 'timestamp_ms' }),
    completedAt: integer('completed_at', { mode: 'timestamp_ms' }),
    createdAt: integer('created_at', { mode: 'timestamp_ms' })
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

export const experimentMetrics = sqliteTable(
  'experiment_metrics',
  {
    id: integer('id', { mode: 'number' }).primaryKey({ autoIncrement: true }),
    runId: text('run_id')
      .notNull()
      .references(() => experimentRuns.id, { onDelete: 'cascade' }),
    serviceId: text('service_id')
      .notNull()
      .references(() => services.id, { onDelete: 'cascade' }),
    virtualTimeUs: blob('virtual_time_us', { mode: 'bigint' }).notNull(),
    wallTimeMs: blob('wall_time_ms', { mode: 'bigint' }).notNull(),
    requestsTotal: integer('requests_total').notNull().default(0),
    requestsFailed: integer('requests_failed').notNull().default(0),
    queueDepth: integer('queue_depth').notNull().default(0),
    activeSlots: integer('active_slots').notNull().default(0),
    circuitState: text('circuit_state').$type<'CLOSED' | 'OPEN' | 'HALF_OPEN'>(),
    latencySamplesUs: text('latency_samples_us', { mode: 'json' }).$type<number[]>(),
    latencyHistogram: text('latency_histogram', { mode: 'json' }).$type<number[]>(),
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
