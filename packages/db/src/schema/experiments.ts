import {
  pgTable,
  uuid,
  varchar,
  text,
  integer,
  bigint,
  jsonb,
  timestamp,
  numeric,
  index,
} from 'drizzle-orm/pg-core';
import { worlds } from './core.js';
import { services, serviceDependencies } from './topology.js';
import { experimentRuns } from './runtime.js';

// 1. Experiments definition table
export const experiments = pgTable(
  'experiments',
  {
    id: uuid('id').defaultRandom().primaryKey(),
    worldId: uuid('world_id')
      .notNull()
      .references(() => worlds.id, { onDelete: 'cascade' }),
    name: varchar('name', { length: 120 }).notNull(),
    hypothesis: text('hypothesis').notNull(),
    status: varchar('status', { length: 30 }).notNull().default('DRAFT'),
    version: integer('version').notNull().default(1),
    baselineDurationMicros: bigint('baseline_duration_micros', { mode: 'bigint' })
      .notNull()
      .default(30000000n),
    faultDurationMicros: bigint('fault_duration_micros', { mode: 'bigint' })
      .notNull()
      .default(30000000n),
    cooldownDurationMicros: bigint('cooldown_duration_micros', { mode: 'bigint' })
      .notNull()
      .default(15000000n),
    frozenConfig: jsonb('frozen_config'),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [index('idx_experiments_world').on(table.worldId, table.status)],
);

// 2. Anomaly detectors configured for an experiment
export const experimentDetectors = pgTable(
  'experiment_detectors',
  {
    id: uuid('id').defaultRandom().primaryKey(),
    experimentId: uuid('experiment_id')
      .notNull()
      .references(() => experiments.id, { onDelete: 'cascade' }),
    name: varchar('name', { length: 120 }).notNull(),
    detectorType: varchar('detector_type', { length: 50 }).notNull(),
    targetServiceId: uuid('target_service_id').references(() => services.id, {
      onDelete: 'cascade',
    }),
    targetEdgeId: uuid('target_edge_id').references(() => serviceDependencies.id, {
      onDelete: 'cascade',
    }),
    thresholdValue: numeric('threshold_value', { precision: 12, scale: 4 }).notNull(),
    windowDurationMicros: bigint('window_duration_micros', { mode: 'bigint' })
      .notNull()
      .default(5000000n),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [index('idx_detectors_experiment').on(table.experimentId)],
);

// 3. Immutable timeline events generated during a run
export const experimentEvents = pgTable(
  'experiment_events',
  {
    id: uuid('id').defaultRandom().primaryKey(),
    runId: uuid('run_id')
      .notNull()
      .references(() => experimentRuns.id, { onDelete: 'cascade' }),
    simTimeMicros: bigint('sim_time_micros', { mode: 'bigint' }).notNull(),
    eventCategory: varchar('event_category', { length: 50 }).notNull(),
    summary: varchar('summary', { length: 255 }).notNull(),
    details: jsonb('details').default({}),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [index('idx_exp_events_timeline').on(table.runId, table.simTimeMicros)],
);
