import { pgTable, uuid, text, integer, bigint, bigserial, jsonb, timestamp, index, primaryKey, check } from 'drizzle-orm/pg-core';
import { sql } from 'drizzle-orm';
import { worlds } from './core.js';
import { services } from './topology.js';

export const experimentRuns = pgTable(
  'experiment_runs',
  {
    id: uuid('id').defaultRandom().primaryKey(),
    worldId: uuid('world_id')
      .notNull()
      .references(() => worlds.id, { onDelete: 'cascade' }),
    seed: bigint('seed', { mode: 'bigint' }).notNull(),
    runtimeMode: text('runtime_mode').notNull().$type<'LOGICAL' | 'CONTAINER' | 'HYBRID'>(),
    engineVersion: text('engine_version').notNull(),
    schemaVersion: integer('schema_version').notNull().default(1),
    gitCommit: text('git_commit'),
    lockfileHash: text('lockfile_hash'),
    frozenConfig: jsonb('frozen_config').notNull(),
    configHash: text('config_hash').notNull(),
    finalStateHash: text('final_state_hash'),
    status: text('status')
      .notNull()
      .default('CREATED')
      .$type<'CREATED' | 'RUNNING' | 'COMPLETED' | 'FAILED' | 'CANCELLED'>(),
    startedAt: timestamp('started_at', { withTimezone: true }),
    completedAt: timestamp('completed_at', { withTimezone: true }),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    index('experiment_runs_world_idx').on(table.worldId, table.status),
    index('experiment_runs_created_idx').on(table.createdAt),
    check('experiment_runs_mode_check', sql`${table.runtimeMode} IN ('LOGICAL','CONTAINER','HYBRID')`),
    check('experiment_runs_status_check', sql`${table.status} IN ('CREATED','RUNNING','COMPLETED','FAILED','CANCELLED')`),
  ]
);

export const experimentMetrics = pgTable(
  'experiment_metrics',
  {
    id: bigserial('id', { mode: 'bigint' }),
    runId: uuid('run_id')
      .notNull()
      .references(() => experimentRuns.id, { onDelete: 'cascade' }),
    serviceId: uuid('service_id')
      .notNull()
      .references(() => services.id, { onDelete: 'cascade' }),
    virtualTimeUs: bigint('virtual_time_us', { mode: 'bigint' }).notNull(),
    wallTimeMs: bigint('wall_time_ms', { mode: 'bigint' }).notNull(),
    requestsTotal: integer('requests_total').notNull().default(0),
    requestsFailed: integer('requests_failed').notNull().default(0),
    queueDepth: integer('queue_depth').notNull().default(0),
    activeSlots: integer('active_slots').notNull().default(0),
    circuitState: text('circuit_state').$type<'CLOSED' | 'OPEN' | 'HALF_OPEN'>(),
    latencySamplesUs: integer('latency_samples_us').array(),
    latencyHistogram: integer('latency_histogram').array(),
  },
  (table) => [
    primaryKey({ columns: [table.id, table.runId] }),
    index('experiment_metrics_run_service_time_idx').on(table.runId, table.serviceId, table.virtualTimeUs),
    check('experiment_metrics_circuit_state_check', sql`${table.circuitState} IS NULL OR ${table.circuitState} IN ('CLOSED','OPEN','HALF_OPEN')`),
  ]
);

export type ExperimentRun = typeof experimentRuns.$inferSelect;
export type NewExperimentRun = typeof experimentRuns.$inferInsert;
export type ExperimentMetric = typeof experimentMetrics.$inferSelect;
export type NewExperimentMetric = typeof experimentMetrics.$inferInsert;
