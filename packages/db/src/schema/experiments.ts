import { mysqlTable, varchar, text, int, bigint, decimal, json, datetime, index } from 'drizzle-orm/mysql-core';
import { worlds } from './core.js';
import { services, serviceDependencies } from './topology.js';
import { experimentRuns } from './runtime.js';

// 1. Experiments definition table
export const experiments = mysqlTable(
  'experiments',
  {
    id: varchar('id', { length: 36 })
      .primaryKey()
      .$defaultFn(() => crypto.randomUUID()),
    worldId: varchar('world_id', { length: 36 })
      .notNull()
      .references(() => worlds.id, { onDelete: 'cascade' }),
    name: varchar('name', { length: 255 }).notNull(),
    hypothesis: varchar('hypothesis', { length: 255 }).notNull(),
    status: varchar('status', { length: 255 }).notNull().default('DRAFT'),
    version: int('version').notNull().default(1),
    baselineDurationMicros: bigint('baseline_duration_micros', { mode: 'bigint', unsigned: true })
      .notNull()
      .default(30000000n),
    faultDurationMicros: bigint('fault_duration_micros', { mode: 'bigint', unsigned: true })
      .notNull()
      .default(30000000n),
    cooldownDurationMicros: bigint('cooldown_duration_micros', { mode: 'bigint', unsigned: true })
      .notNull()
      .default(15000000n),
    frozenConfig: json('frozen_config'),
    createdAt: datetime('created_at', { mode: 'date', fsp: 3 })
      .notNull()
      .$defaultFn(() => new Date()),
    updatedAt: datetime('updated_at', { mode: 'date', fsp: 3 })
      .notNull()
      .$defaultFn(() => new Date()),
  },
  (table) => [index('idx_experiments_world').on(table.worldId, table.status)],
);

// 2. Anomaly detectors configured for an experiment
export const experimentDetectors = mysqlTable(
  'experiment_detectors',
  {
    id: varchar('id', { length: 36 })
      .primaryKey()
      .$defaultFn(() => crypto.randomUUID()),
    experimentId: varchar('experiment_id', { length: 36 })
      .notNull()
      .references(() => experiments.id, { onDelete: 'cascade' }),
    name: varchar('name', { length: 255 }).notNull(),
    detectorType: varchar('detector_type', { length: 255 }).notNull(),
    targetServiceId: varchar('target_service_id', { length: 36 }).references(() => services.id, {
      onDelete: 'cascade',
    }),
    targetEdgeId: varchar('target_edge_id', { length: 36 }).references(() => serviceDependencies.id, {
      onDelete: 'cascade',
    }),
    thresholdValue: decimal('threshold_value', { precision: 18, scale: 6 }).notNull(),
    windowDurationMicros: bigint('window_duration_micros', { mode: 'bigint', unsigned: true })
      .notNull()
      .default(5000000n),
    createdAt: datetime('created_at', { mode: 'date', fsp: 3 })
      .notNull()
      .$defaultFn(() => new Date()),
  },
  (table) => [index('idx_detectors_experiment').on(table.experimentId)],
);

// 3. Immutable timeline events generated during a run
export const experimentEvents = mysqlTable(
  'experiment_events',
  {
    id: varchar('id', { length: 36 })
      .primaryKey()
      .$defaultFn(() => crypto.randomUUID()),
    runId: varchar('run_id', { length: 36 })
      .notNull()
      .references(() => experimentRuns.id, { onDelete: 'cascade' }),
    simTimeMicros: bigint('sim_time_micros', { mode: 'bigint', unsigned: true }).notNull(),
    eventCategory: varchar('event_category', { length: 255 }).notNull(),
    summary: text('summary').notNull(),
    details: json('details').$defaultFn(() => ({})),
    createdAt: datetime('created_at', { mode: 'date', fsp: 3 })
      .notNull()
      .$defaultFn(() => new Date()),
  },
  (table) => [index('idx_exp_events_timeline').on(table.runId, table.simTimeMicros)],
);
