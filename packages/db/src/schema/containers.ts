import {
  pgTable,
  uuid,
  varchar,
  text,
  integer,
  numeric,
  boolean,
  timestamp,
  unique,
  index,
} from 'drizzle-orm/pg-core';
import { worlds } from './core.js';
import { services, serviceDependencies } from './topology.js';

// 1. Runtime deployments
export const runtimeDeployments = pgTable(
  'runtime_deployments',
  {
    id: uuid('id').defaultRandom().primaryKey(),
    worldId: uuid('world_id')
      .notNull()
      .references(() => worlds.id, { onDelete: 'cascade' }),
    runtimeMode: varchar('runtime_mode', { length: 20 }).notNull().default('LOGICAL'),
    topologyVersion: integer('topology_version').notNull().default(1),
    status: varchar('status', { length: 30 }).notNull().default('PENDING'),
    errorMessage: text('error_message'),
    deployedAt: timestamp('deployed_at', { withTimezone: true }).notNull().defaultNow(),
    terminatedAt: timestamp('terminated_at', { withTimezone: true }),
  },
  (table) => [index('idx_deployments_world').on(table.worldId, table.status)],
);

// 2. Container instances
export const containerInstances = pgTable(
  'container_instances',
  {
    id: uuid('id').defaultRandom().primaryKey(),
    worldId: uuid('world_id')
      .notNull()
      .references(() => worlds.id, { onDelete: 'cascade' }),
    deploymentId: uuid('deployment_id')
      .notNull()
      .references(() => runtimeDeployments.id, { onDelete: 'cascade' }),
    serviceId: uuid('service_id')
      .notNull()
      .references(() => services.id, { onDelete: 'cascade' }),
    dockerContainerId: varchar('docker_container_id', { length: 128 }).notNull(),
    dockerImage: varchar('docker_image', { length: 255 }).notNull(),
    servicePort: integer('service_port').notNull(),
    adminPort: integer('admin_port').notNull(),
    toxiproxyPort: integer('toxiproxy_port'),
    status: varchar('status', { length: 30 }).notNull().default('CREATED'),
    cpuLimitCores: numeric('cpu_limit_cores', { precision: 4, scale: 2 }).notNull().default('1.0'),
    memoryLimitMb: integer('memory_limit_mb').notNull().default(256),
    startedAt: timestamp('started_at', { withTimezone: true }),
    stoppedAt: timestamp('stopped_at', { withTimezone: true }),
  },
  (table) => [
    unique('uq_service_deployment').on(table.deploymentId, table.serviceId),
    index('idx_containers_lookup').on(table.worldId, table.status),
    index('idx_containers_docker_id').on(table.dockerContainerId),
  ],
);

// 3. Container edge proxies
export const containerEdgeProxies = pgTable(
  'container_edge_proxies',
  {
    id: uuid('id').defaultRandom().primaryKey(),
    deploymentId: uuid('deployment_id')
      .notNull()
      .references(() => runtimeDeployments.id, { onDelete: 'cascade' }),
    edgeId: uuid('edge_id')
      .notNull()
      .references(() => serviceDependencies.id, { onDelete: 'cascade' }),
    toxiproxyListenPort: integer('toxiproxy_listen_port').notNull(),
    targetHost: varchar('target_host', { length: 120 }).notNull(),
    targetPort: integer('target_port').notNull(),
    isActive: boolean('is_active').notNull().default(true),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    unique('uq_deployment_edge').on(table.deploymentId, table.edgeId),
    index('idx_edge_proxies_deployment').on(table.deploymentId),
  ],
);

export type RuntimeDeploymentRow = typeof runtimeDeployments.$inferSelect;
export type NewRuntimeDeploymentRow = typeof runtimeDeployments.$inferInsert;

export type ContainerInstanceRow = typeof containerInstances.$inferSelect;
export type NewContainerInstanceRow = typeof containerInstances.$inferInsert;

export type ContainerEdgeProxyRow = typeof containerEdgeProxies.$inferSelect;
export type NewContainerEdgeProxyRow = typeof containerEdgeProxies.$inferInsert;
