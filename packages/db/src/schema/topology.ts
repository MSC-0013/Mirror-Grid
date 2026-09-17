import { mysqlTable, varchar, text, int, bigint, decimal, json, datetime, check, index, unique } from 'drizzle-orm/mysql-core';
import { sql } from 'drizzle-orm';
import { worlds } from './core.js';
import type { RetryPolicy, CircuitBreakerPolicy } from '@mirrorgrid/domain';

export const services = mysqlTable(
  'services',
  {
    id: varchar('id', { length: 36 })
      .primaryKey()
      .$defaultFn(() => crypto.randomUUID()),
    worldId: varchar('world_id', { length: 36 })
      .notNull()
      .references(() => worlds.id, { onDelete: 'cascade' }),
    name: varchar('name', { length: 255 }).notNull(),
    description: text('description'),
    serviceType: varchar('service_type', { length: 255 }).notNull().default('HTTP'),
    status: varchar('status', { length: 255 }).notNull().default('STOPPED'),
    targetInstances: int('target_instances').notNull().default(1),
    concurrencyLimit: int('concurrency_limit').notNull().default(64),
    queueCapacity: int('queue_capacity').notNull().default(1000),
    config: json('config')
      .$type<Record<string, unknown>>()
      .notNull()
      .$defaultFn(() => ({})),
    createdAt: datetime('created_at', { mode: 'date', fsp: 3 })
      .notNull()
      .$defaultFn(() => new Date()),
    updatedAt: datetime('updated_at', { mode: 'date', fsp: 3 })
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

export const serviceInstances = mysqlTable(
  'service_instances',
  {
    id: varchar('id', { length: 36 })
      .primaryKey()
      .$defaultFn(() => crypto.randomUUID()),
    serviceId: varchar('service_id', { length: 36 })
      .notNull()
      .references(() => services.id, { onDelete: 'cascade' }),
    worldId: varchar('world_id', { length: 36 })
      .notNull()
      .references(() => worlds.id, { onDelete: 'cascade' }),
    instanceIndex: int('instance_index').notNull(),
    status: varchar('status', { length: 255 }).notNull().default('STOPPED'),
    containerId: varchar('container_id', { length: 36 }),
    createdAt: datetime('created_at', { mode: 'date', fsp: 3 })
      .notNull()
      .$defaultFn(() => new Date()),
    updatedAt: datetime('updated_at', { mode: 'date', fsp: 3 })
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

export const serviceDependencies = mysqlTable(
  'service_dependencies',
  {
    id: varchar('id', { length: 36 })
      .primaryKey()
      .$defaultFn(() => crypto.randomUUID()),
    worldId: varchar('world_id', { length: 36 })
      .notNull()
      .references(() => worlds.id, { onDelete: 'cascade' }),
    sourceServiceId: varchar('source_service_id', { length: 36 })
      .notNull()
      .references(() => services.id, { onDelete: 'cascade' }),
    targetServiceId: varchar('target_service_id', { length: 36 })
      .notNull()
      .references(() => services.id, { onDelete: 'cascade' }),
    timeoutMs: int('timeout_ms').notNull().default(5000),
    criticality: varchar('criticality', { length: 255 }).notNull().default('REQUIRED'),
    retryPolicy: json('retry_policy')
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
    circuitBreakerPolicy: json('circuit_breaker_policy')
      .$type<CircuitBreakerPolicy>()
      .notNull()
      .$defaultFn(() => ({
        enabled: true,
        threshold: 5,
        windowMs: 10000,
        cooldownMs: 30000,
        halfOpenProbes: 3,
      })),
    createdAt: datetime('created_at', { mode: 'date', fsp: 3 })
      .notNull()
      .$defaultFn(() => new Date()),
    updatedAt: datetime('updated_at', { mode: 'date', fsp: 3 })
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

export const workloads = mysqlTable(
  'workloads',
  {
    id: varchar('id', { length: 36 })
      .primaryKey()
      .$defaultFn(() => crypto.randomUUID()),
    worldId: varchar('world_id', { length: 36 })
      .notNull()
      .references(() => worlds.id, { onDelete: 'cascade' }),
    name: varchar('name', { length: 255 }).notNull(),
    targetServiceId: varchar('target_service_id', { length: 36 })
      .notNull()
      .references(() => services.id, { onDelete: 'cascade' }),
    pattern: varchar('pattern', { length: 255 }).notNull().default('CONSTANT'),
    baseRate: decimal('base_rate', { precision: 18, scale: 6 }).notNull(),
    peakRate: decimal('peak_rate', { precision: 18, scale: 6 }),
    durationMs: bigint('duration_ms', { mode: 'bigint', unsigned: true }),
    config: json('config')
      .$type<Record<string, unknown>>()
      .notNull()
      .$defaultFn(() => ({})),
    createdAt: datetime('created_at', { mode: 'date', fsp: 3 })
      .notNull()
      .$defaultFn(() => new Date()),
    updatedAt: datetime('updated_at', { mode: 'date', fsp: 3 })
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
