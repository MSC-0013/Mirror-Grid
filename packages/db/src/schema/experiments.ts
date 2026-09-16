import { sqliteTable, text, integer, blob, numeric, index } from 'drizzle-orm/sqlite-core';
import { worlds } from './core.js';
import { services, serviceDependencies } from './topology.js';
import { experimentRuns } from './runtime.js';

// 1. Experiments definition table
export const experiments = sqliteTable(
  'experiments',
  {
    id: text('id')
      .primaryKey()
      .$defaultFn(() => crypto.randomUUID()),
    worldId: text('world_id')
      .notNull()
      .references(() => worlds.id, { onDelete: 'cascade' }),
    name: text('name').notNull(),
    hypothesis: text('hypothesis').notNull(),
    status: text('status').notNull().default('DRAFT'),
    version: integer('version').notNull().default(1),
    baselineDurationMicros: blob('baseline_duration_micros', { mode: 'bigint' })
      .notNull()
      .default(30000000n),
    faultDurationMicros: blob('fault_duration_micros', { mode: 'bigint' })
      .notNull()
      .default(30000000n),
    cooldownDurationMicros: blob('cooldown_duration_micros', { mode: 'bigint' })
      .notNull()
      .default(15000000n),
    frozenConfig: text('frozen_config', { mode: 'json' }),
    createdAt: integer('created_at', { mode: 'timestamp_ms' })
      .notNull()
      .$defaultFn(() => new Date()),
    updatedAt: integer('updated_at', { mode: 'timestamp_ms' })
      .notNull()
      .$defaultFn(() => new Date()),
  },
  (table) => [index('idx_experiments_world').on(table.worldId, table.status)],
);

// 2. Anomaly detectors configured for an experiment
export const experimentDetectors = sqliteTable(
  'experiment_detectors',
  {
    id: text('id')
      .primaryKey()
      .$defaultFn(() => crypto.randomUUID()),
    experimentId: text('experiment_id')
      .notNull()
      .references(() => experiments.id, { onDelete: 'cascade' }),
    name: text('name').notNull(),
    detectorType: text('detector_type').notNull(),
    targetServiceId: text('target_service_id').references(() => services.id, {
      onDelete: 'cascade',
    }),
    targetEdgeId: text('target_edge_id').references(() => serviceDependencies.id, {
      onDelete: 'cascade',
    }),
    thresholdValue: numeric('threshold_value').notNull(),
    windowDurationMicros: blob('window_duration_micros', { mode: 'bigint' })
      .notNull()
      .default(5000000n),
    createdAt: integer('created_at', { mode: 'timestamp_ms' })
      .notNull()
      .$defaultFn(() => new Date()),
  },
  (table) => [index('idx_detectors_experiment').on(table.experimentId)],
);

// 3. Immutable timeline events generated during a run
export const experimentEvents = sqliteTable(
  'experiment_events',
  {
    id: text('id')
      .primaryKey()
      .$defaultFn(() => crypto.randomUUID()),
    runId: text('run_id')
      .notNull()
      .references(() => experimentRuns.id, { onDelete: 'cascade' }),
    simTimeMicros: blob('sim_time_micros', { mode: 'bigint' }).notNull(),
    eventCategory: text('event_category').notNull(),
    summary: text('summary').notNull(),
    details: text('details', { mode: 'json' }).$defaultFn(() => ({})),
    createdAt: integer('created_at', { mode: 'timestamp_ms' })
      .notNull()
      .$defaultFn(() => new Date()),
  },
  (table) => [index('idx_exp_events_timeline').on(table.runId, table.simTimeMicros)],
);
