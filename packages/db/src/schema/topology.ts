import {
  sqliteTable,
  text,
  integer,
  blob,
  numeric,
  unique,
  index,
  check,
} from 'drizzle-orm/sqlite-core';
import { sql } from 'drizzle-orm';
import { worlds } from './core.js';
import type { RetryPolicy, CircuitBreakerPolicy } from '@mirrorgrid/domain';

export const services = sqliteTable(
  'services',
  {
    id: text('id')
      .primaryKey()
      .$defaultFn(() => crypto.randomUUID()),
    worldId: text('world_id')
      .notNull()
      .references(() => worlds.id, { onDelete: 'cascade' }),
    name: text('name').notNull(),
    description: text('description'),
    serviceType: text('service_type').notNull().default('HTTP'),
    status: text('status').notNull().default('STOPPED'),
    targetInstances: integer('target_instances').notNull().default(1),
    concurrencyLimit: integer('concurrency_limit').notNull().default(64),
    queueCapacity: integer('queue_capacity').notNull().default(1000),
    config: text('config', { mode: 'json' })
      .$type<Record<string, unknown>>()
      .notNull()
      .$defaultFn(() => ({})),
    createdAt: integer('created_at', { mode: 'timestamp_ms' })
      .notNull()
      .$defaultFn(() => new Date()),
    updatedAt: integer('updated_at', { mode: 'timestamp_ms' })
      .notNull()
      .$defaultFn(() => new Date()),
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

export const serviceInstances = sqliteTable(
  'service_instances',
  {
    id: text('id')
      .primaryKey()
      .$defaultFn(() => crypto.randomUUID()),
    serviceId: text('service_id')
      .notNull()
      .references(() => services.id, { onDelete: 'cascade' }),
    worldId: text('world_id')
      .notNull()
      .references(() => worlds.id, { onDelete: 'cascade' }),
    instanceIndex: integer('instance_index').notNull(),
    status: text('status').notNull().default('STOPPED'),
    containerId: text('container_id'),
    createdAt: integer('created_at', { mode: 'timestamp_ms' })
      .notNull()
      .$defaultFn(() => new Date()),
    updatedAt: integer('updated_at', { mode: 'timestamp_ms' })
      .notNull()
      .$defaultFn(() => new Date()),
  },
  (table) => [
    unique('service_instances_service_index_unique').on(table.serviceId, table.instanceIndex),
    check(
      'service_instances_status_check',
      sql`${table.status} IN ('STOPPED','STARTING','HEALTHY','DEGRADED','PARTIALLY_AVAILABLE','UNHEALTHY','FAILED','UNKNOWN')`,
    ),
  ],
);

export const serviceDependencies = sqliteTable(
  'service_dependencies',
  {
    id: text('id')
      .primaryKey()
      .$defaultFn(() => crypto.randomUUID()),
    worldId: text('world_id')
      .notNull()
      .references(() => worlds.id, { onDelete: 'cascade' }),
    sourceServiceId: text('source_service_id')
      .notNull()
      .references(() => services.id, { onDelete: 'cascade' }),
    targetServiceId: text('target_service_id')
      .notNull()
      .references(() => services.id, { onDelete: 'cascade' }),
    timeoutMs: integer('timeout_ms').notNull().default(5000),
    criticality: text('criticality').notNull().default('REQUIRED'),
    retryPolicy: text('retry_policy', { mode: 'json' })
      .$type<RetryPolicy>()
      .notNull()
      .$defaultFn(() => ({
        type: 'EXPONENTIAL',
        maxAttempts: 3,
        baseDelayMs: 100,
        maxDelayMs: 30000,
        jitterFactor: 0.25,
        budgetPercent: 20,
      })),
    circuitBreakerPolicy: text('circuit_breaker_policy', { mode: 'json' })
      .$type<CircuitBreakerPolicy>()
      .notNull()
      .$defaultFn(() => ({
        enabled: true,
        threshold: 5,
        windowMs: 10000,
        cooldownMs: 30000,
        halfOpenProbes: 3,
      })),
    createdAt: integer('created_at', { mode: 'timestamp_ms' })
      .notNull()
      .$defaultFn(() => new Date()),
    updatedAt: integer('updated_at', { mode: 'timestamp_ms' })
      .notNull()
      .$defaultFn(() => new Date()),
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

export const workloads = sqliteTable(
  'workloads',
  {
    id: text('id')
      .primaryKey()
      .$defaultFn(() => crypto.randomUUID()),
    worldId: text('world_id')
      .notNull()
      .references(() => worlds.id, { onDelete: 'cascade' }),
    name: text('name').notNull(),
    targetServiceId: text('target_service_id')
      .notNull()
      .references(() => services.id, { onDelete: 'cascade' }),
    pattern: text('pattern').notNull().default('CONSTANT'),
    baseRate: numeric('base_rate').notNull(),
    peakRate: numeric('peak_rate'),
    durationMs: blob('duration_ms', { mode: 'bigint' }),
    config: text('config', { mode: 'json' })
      .$type<Record<string, unknown>>()
      .notNull()
      .$defaultFn(() => ({})),
    createdAt: integer('created_at', { mode: 'timestamp_ms' })
      .notNull()
      .$defaultFn(() => new Date()),
    updatedAt: integer('updated_at', { mode: 'timestamp_ms' })
      .notNull()
      .$defaultFn(() => new Date()),
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
