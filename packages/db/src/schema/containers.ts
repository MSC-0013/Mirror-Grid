import { sqliteTable, text, integer, numeric, unique, index } from 'drizzle-orm/sqlite-core';
import { worlds } from './core.js';
import { services, serviceDependencies } from './topology.js';

// 1. Runtime deployments
export const runtimeDeployments = sqliteTable(
  'runtime_deployments',
  {
    id: text('id')
      .primaryKey()
      .$defaultFn(() => crypto.randomUUID()),
    worldId: text('world_id')
      .notNull()
      .references(() => worlds.id, { onDelete: 'cascade' }),
    runtimeMode: text('runtime_mode').notNull().default('LOGICAL'),
    topologyVersion: integer('topology_version').notNull().default(1),
    status: text('status').notNull().default('PENDING'),
    errorMessage: text('error_message'),
    deployedAt: integer('deployed_at', { mode: 'timestamp_ms' })
      .notNull()
      .$defaultFn(() => new Date()),
    terminatedAt: integer('terminated_at', { mode: 'timestamp_ms' }),
  },
  (table) => [index('idx_deployments_world').on(table.worldId, table.status)],
);

// 2. Container instances
export const containerInstances = sqliteTable(
  'container_instances',
  {
    id: text('id')
      .primaryKey()
      .$defaultFn(() => crypto.randomUUID()),
    worldId: text('world_id')
      .notNull()
      .references(() => worlds.id, { onDelete: 'cascade' }),
    deploymentId: text('deployment_id')
      .notNull()
      .references(() => runtimeDeployments.id, { onDelete: 'cascade' }),
    serviceId: text('service_id')
      .notNull()
      .references(() => services.id, { onDelete: 'cascade' }),
    dockerContainerId: text('docker_container_id').notNull(),
    dockerImage: text('docker_image').notNull(),
    servicePort: integer('service_port').notNull(),
    adminPort: integer('admin_port').notNull(),
    toxiproxyPort: integer('toxiproxy_port'),
    status: text('status').notNull().default('CREATED'),
    cpuLimitCores: numeric('cpu_limit_cores').notNull().default('1.0'),
    memoryLimitMb: integer('memory_limit_mb').notNull().default(256),
    startedAt: integer('started_at', { mode: 'timestamp_ms' }),
    stoppedAt: integer('stopped_at', { mode: 'timestamp_ms' }),
  },
  (table) => [
    unique('uq_service_deployment').on(table.deploymentId, table.serviceId),
    index('idx_containers_lookup').on(table.worldId, table.status),
    index('idx_containers_docker_id').on(table.dockerContainerId),
  ],
);

// 3. Edge proxy routing records
export const containerEdgeProxies = sqliteTable(
  'container_edge_proxies',
  {
    id: text('id')
      .primaryKey()
      .$defaultFn(() => crypto.randomUUID()),
    deploymentId: text('deployment_id')
      .notNull()
      .references(() => runtimeDeployments.id, { onDelete: 'cascade' }),
    edgeId: text('edge_id')
      .notNull()
      .references(() => serviceDependencies.id, { onDelete: 'cascade' }),
    toxiproxyListenPort: integer('toxiproxy_listen_port').notNull(),
    targetHost: text('target_host').notNull(),
    targetPort: integer('target_port').notNull(),
    isActive: integer('is_active', { mode: 'boolean' }).notNull().default(true),
    createdAt: integer('created_at', { mode: 'timestamp_ms' })
      .notNull()
      .$defaultFn(() => new Date()),
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
