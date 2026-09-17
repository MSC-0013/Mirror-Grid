import { mysqlTable, varchar, text, int, bigint, json, datetime, index, unique } from 'drizzle-orm/mysql-core';
import { worlds } from './core.js';
import { services, serviceDependencies } from './topology.js';

// 1. Fault specifications
export const faultSpecifications = mysqlTable(
  'fault_specifications',
  {
    id: varchar('id', { length: 36 })
      .primaryKey()
      .$defaultFn(() => crypto.randomUUID()),
    worldId: varchar('world_id', { length: 36 })
      .notNull()
      .references(() => worlds.id, { onDelete: 'cascade' }),
    name: varchar('name', { length: 255 }).notNull(),
    description: text('description'),
    faultType: varchar('fault_type', { length: 255 }).notNull(),
    targetServiceId: varchar('target_service_id', { length: 36 }).references(() => services.id, {
      onDelete: 'cascade',
    }),
    targetEdgeId: varchar('target_edge_id', { length: 36 }).references(() => serviceDependencies.id, {
      onDelete: 'cascade',
    }),
    parameters: json('parameters')
      .notNull()
      .$defaultFn(() => ({})),
    safetyRules: json('safety_rules')
      .notNull()
      .$defaultFn(() => ({ maxDurationMicros: 300000000, autoAbortOnBurnRate: true })),
    createdAt: datetime('created_at', { mode: 'date', fsp: 3 })
      .notNull()
      .$defaultFn(() => new Date()),
    updatedAt: datetime('updated_at', { mode: 'date', fsp: 3 })
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
export const experimentFaults = mysqlTable(
  'experiment_faults',
  {
    id: varchar('id', { length: 36 })
      .primaryKey()
      .$defaultFn(() => crypto.randomUUID()),
    worldId: varchar('world_id', { length: 36 })
      .notNull()
      .references(() => worlds.id, { onDelete: 'cascade' }),
    experimentId: varchar('experiment_id', { length: 36 }),
    faultSpecId: text('fault_spec_id')
      .notNull()
      .references(() => faultSpecifications.id, { onDelete: 'cascade' }),
    status: varchar('status', { length: 255 }).notNull().default('SCHEDULED'),
    scheduledStartMicros: bigint('scheduled_start_micros', { mode: 'bigint', unsigned: true }).notNull(),
    scheduledDurationMicros: bigint('scheduled_duration_micros', { mode: 'bigint', unsigned: true }).notNull(),
    actualStartMicros: bigint('actual_start_micros', { mode: 'bigint', unsigned: true }),
    actualEndMicros: bigint('actual_end_micros', { mode: 'bigint', unsigned: true }),
    abortReason: text('abort_reason'),
    appliedParameters: json('applied_parameters').notNull(),
    createdAt: datetime('created_at', { mode: 'date', fsp: 3 })
      .notNull()
      .$defaultFn(() => new Date()),
    updatedAt: datetime('updated_at', { mode: 'date', fsp: 3 })
      .notNull()
      .$defaultFn(() => new Date()),
  },
  (table) => [
    index('idx_exp_faults_world_status').on(table.worldId, table.status),
    index('idx_exp_faults_timing').on(table.scheduledStartMicros, table.scheduledDurationMicros),
  ],
);

// 3. Circuit breaker state snapshots
export const circuitBreakerStates = mysqlTable(
  'circuit_breaker_states',
  {
    id: varchar('id', { length: 36 })
      .primaryKey()
      .$defaultFn(() => crypto.randomUUID()),
    worldId: varchar('world_id', { length: 36 })
      .notNull()
      .references(() => worlds.id, { onDelete: 'cascade' }),
    serviceId: varchar('service_id', { length: 36 })
      .notNull()
      .references(() => services.id, { onDelete: 'cascade' }),
    edgeId: varchar('edge_id', { length: 36 }).references(() => serviceDependencies.id, {
      onDelete: 'cascade',
    }),
    currentState: varchar('current_state', { length: 255 }).notNull().default('CLOSED'),
    stateEnteredAtMicros: bigint('state_entered_at_micros', { mode: 'bigint', unsigned: true }).notNull().default(0n),
    failureRatePpm: int('failure_rate_ppm').notNull().default(0),
    consecutiveFailures: int('consecutive_failures').notNull().default(0),
    consecutiveSuccesses: int('consecutive_successes').notNull().default(0),
    totalRequests: bigint('total_requests', { mode: 'bigint', unsigned: true }).notNull().default(0n),
    totalRejections: bigint('total_rejections', { mode: 'bigint', unsigned: true }).notNull().default(0n),
    updatedAt: datetime('updated_at', { mode: 'date', fsp: 3 })
      .notNull()
      .$defaultFn(() => new Date()),
  },
  (table) => [
    unique('uq_breaker_world_service_edge').on(table.worldId, table.serviceId, table.edgeId),
    index('idx_cb_states_lookup').on(table.worldId, table.currentState),
  ],
);

// 4. Circuit breaker transition log
export const circuitBreakerTransitions = mysqlTable(
  'circuit_breaker_transitions',
  {
    id: varchar('id', { length: 36 })
      .primaryKey()
      .$defaultFn(() => crypto.randomUUID()),
    worldId: varchar('world_id', { length: 36 })
      .notNull()
      .references(() => worlds.id, { onDelete: 'cascade' }),
    serviceId: varchar('service_id', { length: 36 })
      .notNull()
      .references(() => services.id, { onDelete: 'cascade' }),
    edgeId: varchar('edge_id', { length: 36 }).references(() => serviceDependencies.id, {
      onDelete: 'cascade',
    }),
    fromState: varchar('from_state', { length: 255 }).notNull(),
    toState: varchar('to_state', { length: 255 }).notNull(),
    transitionReason: text('transition_reason').notNull(),
    eventMicros: bigint('event_micros', { mode: 'bigint', unsigned: true }).notNull(),
    failureRatePpm: int('failure_rate_ppm'),
    createdAt: datetime('created_at', { mode: 'date', fsp: 3 })
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
