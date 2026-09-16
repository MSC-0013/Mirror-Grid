import { sqliteTable, text, integer, blob, unique, index } from 'drizzle-orm/sqlite-core';
import { worlds } from './core.js';
import { services, serviceDependencies } from './topology.js';

// 1. Fault specifications
export const faultSpecifications = sqliteTable(
  'fault_specifications',
  {
    id: text('id')
      .primaryKey()
      .$defaultFn(() => crypto.randomUUID()),
    worldId: text('world_id')
      .notNull()
      .references(() => worlds.id, { onDelete: 'cascade' }),
    name: text('name').notNull(),
    description: text('description'),
    faultType: text('fault_type').notNull(),
    targetServiceId: text('target_service_id').references(() => services.id, {
      onDelete: 'cascade',
    }),
    targetEdgeId: text('target_edge_id').references(() => serviceDependencies.id, {
      onDelete: 'cascade',
    }),
    parameters: text('parameters', { mode: 'json' })
      .notNull()
      .$defaultFn(() => ({})),
    safetyRules: text('safety_rules', { mode: 'json' })
      .notNull()
      .$defaultFn(() => ({ maxDurationMicros: 300000000, autoAbortOnBurnRate: true })),
    createdAt: integer('created_at', { mode: 'timestamp_ms' })
      .notNull()
      .$defaultFn(() => new Date()),
    updatedAt: integer('updated_at', { mode: 'timestamp_ms' })
      .notNull()
      .$defaultFn(() => new Date()),
  },
  (table) => [
    index('idx_fault_spec_world').on(table.worldId),
    index('idx_fault_spec_target_svc').on(table.targetServiceId),
    index('idx_fault_spec_target_edge').on(table.targetEdgeId),
  ],
);

// 2. Experiment fault executions
export const experimentFaults = sqliteTable(
  'experiment_faults',
  {
    id: text('id')
      .primaryKey()
      .$defaultFn(() => crypto.randomUUID()),
    worldId: text('world_id')
      .notNull()
      .references(() => worlds.id, { onDelete: 'cascade' }),
    experimentId: text('experiment_id'),
    faultSpecId: text('fault_spec_id')
      .notNull()
      .references(() => faultSpecifications.id, { onDelete: 'cascade' }),
    status: text('status').notNull().default('SCHEDULED'),
    scheduledStartMicros: blob('scheduled_start_micros', { mode: 'bigint' }).notNull(),
    scheduledDurationMicros: blob('scheduled_duration_micros', { mode: 'bigint' }).notNull(),
    actualStartMicros: blob('actual_start_micros', { mode: 'bigint' }),
    actualEndMicros: blob('actual_end_micros', { mode: 'bigint' }),
    abortReason: text('abort_reason'),
    appliedParameters: text('applied_parameters', { mode: 'json' }).notNull(),
    createdAt: integer('created_at', { mode: 'timestamp_ms' })
      .notNull()
      .$defaultFn(() => new Date()),
    updatedAt: integer('updated_at', { mode: 'timestamp_ms' })
      .notNull()
      .$defaultFn(() => new Date()),
  },
  (table) => [
    index('idx_exp_faults_world_status').on(table.worldId, table.status),
    index('idx_exp_faults_timing').on(table.scheduledStartMicros, table.scheduledDurationMicros),
  ],
);

// 3. Circuit breaker state snapshots
export const circuitBreakerStates = sqliteTable(
  'circuit_breaker_states',
  {
    id: text('id')
      .primaryKey()
      .$defaultFn(() => crypto.randomUUID()),
    worldId: text('world_id')
      .notNull()
      .references(() => worlds.id, { onDelete: 'cascade' }),
    serviceId: text('service_id')
      .notNull()
      .references(() => services.id, { onDelete: 'cascade' }),
    edgeId: text('edge_id').references(() => serviceDependencies.id, {
      onDelete: 'cascade',
    }),
    currentState: text('current_state').notNull().default('CLOSED'),
    stateEnteredAtMicros: blob('state_entered_at_micros', { mode: 'bigint' }).notNull().default(0n),
    failureRatePpm: integer('failure_rate_ppm').notNull().default(0),
    consecutiveFailures: integer('consecutive_failures').notNull().default(0),
    consecutiveSuccesses: integer('consecutive_successes').notNull().default(0),
    totalRequests: blob('total_requests', { mode: 'bigint' }).notNull().default(0n),
    totalRejections: blob('total_rejections', { mode: 'bigint' }).notNull().default(0n),
    updatedAt: integer('updated_at', { mode: 'timestamp_ms' })
      .notNull()
      .$defaultFn(() => new Date()),
  },
  (table) => [
    unique('uq_breaker_world_service_edge').on(table.worldId, table.serviceId, table.edgeId),
    index('idx_cb_states_lookup').on(table.worldId, table.currentState),
  ],
);

// 4. Circuit breaker transition log
export const circuitBreakerTransitions = sqliteTable(
  'circuit_breaker_transitions',
  {
    id: text('id')
      .primaryKey()
      .$defaultFn(() => crypto.randomUUID()),
    worldId: text('world_id')
      .notNull()
      .references(() => worlds.id, { onDelete: 'cascade' }),
    serviceId: text('service_id')
      .notNull()
      .references(() => services.id, { onDelete: 'cascade' }),
    edgeId: text('edge_id').references(() => serviceDependencies.id, {
      onDelete: 'cascade',
    }),
    fromState: text('from_state').notNull(),
    toState: text('to_state').notNull(),
    transitionReason: text('transition_reason').notNull(),
    eventMicros: blob('event_micros', { mode: 'bigint' }).notNull(),
    failureRatePpm: integer('failure_rate_ppm'),
    createdAt: integer('created_at', { mode: 'timestamp_ms' })
      .notNull()
      .$defaultFn(() => new Date()),
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
