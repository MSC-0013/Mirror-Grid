import {
  pgTable,
  uuid,
  text,
  integer,
  bigint,
  numeric,
  jsonb,
  timestamp,
  unique,
  index,
  check,
} from 'drizzle-orm/pg-core';
import { sql } from 'drizzle-orm';
import { worlds } from './core.js';
import type { RetryPolicy, CircuitBreakerPolicy } from '@mirrorgrid/domain';

export const services = pgTable(
  'services',
  {
    id: uuid('id').defaultRandom().primaryKey(),
    worldId: uuid('world_id')
      .notNull()
      .references(() => worlds.id, { onDelete: 'cascade' }),
    name: text('name').notNull(),
    description: text('description'),
    serviceType: text('service_type').notNull().default('HTTP'),
    status: text('status').notNull().default('STOPPED'),
    targetInstances: integer('target_instances').notNull().default(1),
    concurrencyLimit: integer('concurrency_limit').notNull().default(64),
    queueCapacity: integer('queue_capacity').notNull().default(1000),
    config: jsonb('config').$type<Record<string, unknown>>().notNull().default({}),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    unique('services_world_name_unique').on(table.worldId, table.name),
    index('services_world_status_idx').on(table.worldId, table.status),
    check(
      'services_service_type_check',
      sql`${table.serviceType} IN ('HTTP','GRPC','WORKER','DATABASE','CACHE','MESSAGE_BROKER')`,
    ),
    check(
      'services_status_check',
      sql`${table.status} IN ('STOPPED','STARTING','HEALTHY','DEGRADED','PARTIALLY_AVAILABLE','UNHEALTHY','FAILED','UNKNOWN')`,
    ),
    check(
      'services_target_instances_check',
      sql`${table.targetInstances} >= 1 AND ${table.targetInstances} <= 100`,
    ),
    check('services_concurrency_limit_check', sql`${table.concurrencyLimit} >= 1`),
    check('services_queue_capacity_check', sql`${table.queueCapacity} >= 0`),
  ],
);

export const serviceInstances = pgTable(
  'service_instances',
  {
    id: uuid('id').defaultRandom().primaryKey(),
    serviceId: uuid('service_id')
      .notNull()
      .references(() => services.id, { onDelete: 'cascade' }),
    worldId: uuid('world_id')
      .notNull()
      .references(() => worlds.id, { onDelete: 'cascade' }),
    instanceIndex: integer('instance_index').notNull(),
    status: text('status').notNull().default('STOPPED'),
    containerId: text('container_id'),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    unique('service_instances_service_index_unique').on(table.serviceId, table.instanceIndex),
    check(
      'service_instances_status_check',
      sql`${table.status} IN ('STOPPED','STARTING','HEALTHY','DEGRADED','PARTIALLY_AVAILABLE','UNHEALTHY','FAILED','UNKNOWN')`,
    ),
  ],
);

export const serviceDependencies = pgTable(
  'service_dependencies',
  {
    id: uuid('id').defaultRandom().primaryKey(),
    worldId: uuid('world_id')
      .notNull()
      .references(() => worlds.id, { onDelete: 'cascade' }),
    sourceServiceId: uuid('source_service_id')
      .notNull()
      .references(() => services.id, { onDelete: 'cascade' }),
    targetServiceId: uuid('target_service_id')
      .notNull()
      .references(() => services.id, { onDelete: 'cascade' }),
    timeoutMs: integer('timeout_ms').notNull().default(5000),
    criticality: text('criticality').notNull().default('REQUIRED'),
    retryPolicy: jsonb('retry_policy')
      .$type<RetryPolicy>()
      .notNull()
      .default(
        sql`'{"type":"EXPONENTIAL","maxAttempts":3,"baseDelayMs":100,"maxDelayMs":30000,"jitterFactor":0.25,"budgetPercent":20}'::jsonb`,
      ),
    circuitBreakerPolicy: jsonb('circuit_breaker_policy')
      .$type<CircuitBreakerPolicy>()
      .notNull()
      .default(
        sql`'{"enabled":true,"threshold":5,"windowMs":10000,"cooldownMs":30000,"halfOpenProbes":3}'::jsonb`,
      ),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    unique('service_dependencies_source_target_unique').on(
      table.sourceServiceId,
      table.targetServiceId,
    ),
    index('service_deps_source_idx').on(table.sourceServiceId),
    index('service_deps_target_idx').on(table.targetServiceId),
    index('service_deps_world_idx').on(table.worldId),
    check('service_deps_timeout_check', sql`${table.timeoutMs} > 0`),
    check(
      'service_deps_criticality_check',
      sql`${table.criticality} IN ('REQUIRED','OPTIONAL','BEST_EFFORT')`,
    ),
    check(
      'service_deps_no_self_edge_check',
      sql`${table.sourceServiceId} != ${table.targetServiceId}`,
    ),
  ],
);

export const workloads = pgTable(
  'workloads',
  {
    id: uuid('id').defaultRandom().primaryKey(),
    worldId: uuid('world_id')
      .notNull()
      .references(() => worlds.id, { onDelete: 'cascade' }),
    name: text('name').notNull(),
    targetServiceId: uuid('target_service_id')
      .notNull()
      .references(() => services.id, { onDelete: 'cascade' }),
    pattern: text('pattern').notNull().default('CONSTANT'),
    baseRate: numeric('base_rate').notNull(),
    peakRate: numeric('peak_rate'),
    durationMs: bigint('duration_ms', { mode: 'bigint' }),
    config: jsonb('config').$type<Record<string, unknown>>().notNull().default({}),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    unique('workloads_world_name_unique').on(table.worldId, table.name),
    check(
      'workloads_pattern_check',
      sql`${table.pattern} IN ('CONSTANT','RAMP_UP','RAMP_DOWN','BURST','SPIKE','RANDOM')`,
    ),
    check('workloads_base_rate_check', sql`${table.baseRate} >= 0`),
  ],
);

export type ServiceRow = typeof services.$inferSelect;
export type NewServiceRow = typeof services.$inferInsert;

export type ServiceInstanceRow = typeof serviceInstances.$inferSelect;
export type NewServiceInstanceRow = typeof serviceInstances.$inferInsert;

export type ServiceDependencyRow = typeof serviceDependencies.$inferSelect;
export type NewServiceDependencyRow = typeof serviceDependencies.$inferInsert;

export type WorkloadRow = typeof workloads.$inferSelect;
export type NewWorkloadRow = typeof workloads.$inferInsert;
