import {
  pgTable,
  uuid,
  varchar,
  text,
  integer,
  bigint,
  jsonb,
  timestamp,
  unique,
  index,
} from 'drizzle-orm/pg-core';
import { worlds } from './core.js';
import { services, serviceDependencies } from './topology.js';

// 1. Fault specifications
export const faultSpecifications = pgTable(
  'fault_specifications',
  {
    id: uuid('id').defaultRandom().primaryKey(),
    worldId: uuid('world_id')
      .notNull()
      .references(() => worlds.id, { onDelete: 'cascade' }),
    name: varchar('name', { length: 120 }).notNull(),
    description: text('description'),
    faultType: varchar('fault_type', { length: 50 }).notNull(),
    targetServiceId: uuid('target_service_id').references(() => services.id, {
      onDelete: 'cascade',
    }),
    targetEdgeId: uuid('target_edge_id').references(() => serviceDependencies.id, {
      onDelete: 'cascade',
    }),
    parameters: jsonb('parameters').notNull().default({}),
    safetyRules: jsonb('safety_rules')
      .notNull()
      .default({ maxDurationMicros: 300000000, autoAbortOnBurnRate: true }),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    index('idx_fault_spec_world').on(table.worldId),
    index('idx_fault_spec_target_svc').on(table.targetServiceId),
    index('idx_fault_spec_target_edge').on(table.targetEdgeId),
  ],
);

// 2. Experiment fault executions
export const experimentFaults = pgTable(
  'experiment_faults',
  {
    id: uuid('id').defaultRandom().primaryKey(),
    worldId: uuid('world_id')
      .notNull()
      .references(() => worlds.id, { onDelete: 'cascade' }),
    experimentId: uuid('experiment_id'),
    faultSpecId: uuid('fault_spec_id')
      .notNull()
      .references(() => faultSpecifications.id, { onDelete: 'cascade' }),
    status: varchar('status', { length: 30 }).notNull().default('SCHEDULED'),
    scheduledStartMicros: bigint('scheduled_start_micros', { mode: 'bigint' }).notNull(),
    scheduledDurationMicros: bigint('scheduled_duration_micros', { mode: 'bigint' }).notNull(),
    actualStartMicros: bigint('actual_start_micros', { mode: 'bigint' }),
    actualEndMicros: bigint('actual_end_micros', { mode: 'bigint' }),
    abortReason: text('abort_reason'),
    appliedParameters: jsonb('applied_parameters').notNull(),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    index('idx_exp_faults_world_status').on(table.worldId, table.status),
    index('idx_exp_faults_timing').on(table.scheduledStartMicros, table.scheduledDurationMicros),
  ],
);

// 3. Circuit breaker state snapshots
export const circuitBreakerStates = pgTable(
  'circuit_breaker_states',
  {
    id: uuid('id').defaultRandom().primaryKey(),
    worldId: uuid('world_id')
      .notNull()
      .references(() => worlds.id, { onDelete: 'cascade' }),
    serviceId: uuid('service_id')
      .notNull()
      .references(() => services.id, { onDelete: 'cascade' }),
    edgeId: uuid('edge_id').references(() => serviceDependencies.id, {
      onDelete: 'cascade',
    }),
    currentState: varchar('current_state', { length: 20 }).notNull().default('CLOSED'),
    stateEnteredAtMicros: bigint('state_entered_at_micros', { mode: 'bigint' })
      .notNull()
      .default(0n),
    failureRatePpm: integer('failure_rate_ppm').notNull().default(0),
    consecutiveFailures: integer('consecutive_failures').notNull().default(0),
    consecutiveSuccesses: integer('consecutive_successes').notNull().default(0),
    totalRequests: bigint('total_requests', { mode: 'bigint' }).notNull().default(0n),
    totalRejections: bigint('total_rejections', { mode: 'bigint' }).notNull().default(0n),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    unique('uq_breaker_world_service_edge').on(table.worldId, table.serviceId, table.edgeId),
    index('idx_cb_states_lookup').on(table.worldId, table.currentState),
  ],
);

// 4. Circuit breaker transition log
export const circuitBreakerTransitions = pgTable(
  'circuit_breaker_transitions',
  {
    id: uuid('id').defaultRandom().primaryKey(),
    worldId: uuid('world_id')
      .notNull()
      .references(() => worlds.id, { onDelete: 'cascade' }),
    serviceId: uuid('service_id')
      .notNull()
      .references(() => services.id, { onDelete: 'cascade' }),
    edgeId: uuid('edge_id').references(() => serviceDependencies.id, {
      onDelete: 'cascade',
    }),
    fromState: varchar('from_state', { length: 20 }).notNull(),
    toState: varchar('to_state', { length: 20 }).notNull(),
    transitionReason: varchar('transition_reason', { length: 100 }).notNull(),
    eventMicros: bigint('event_micros', { mode: 'bigint' }).notNull(),
    failureRatePpm: integer('failure_rate_ppm'),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [index('idx_cb_transitions_timeline').on(table.worldId, table.eventMicros)],
);

export type FaultSpecificationRow = typeof faultSpecifications.$inferSelect;
export type NewFaultSpecificationRow = typeof faultSpecifications.$inferInsert;

export type ExperimentFaultRow = typeof experimentFaults.$inferSelect;
export type NewExperimentFaultRow = typeof experimentFaults.$inferInsert;

export type CircuitBreakerStateRow = typeof circuitBreakerStates.$inferSelect;
export type NewCircuitBreakerStateRow = typeof circuitBreakerStates.$inferInsert;

export type CircuitBreakerTransitionRow = typeof circuitBreakerTransitions.$inferSelect;
export type NewCircuitBreakerTransitionRow = typeof circuitBreakerTransitions.$inferInsert;
