import { mysqlTable, varchar, text, int, decimal, boolean, datetime, index, unique } from 'drizzle-orm/mysql-core';
import { worlds } from './core.js';
import { services, serviceDependencies } from './topology.js';

// 1. Runtime deployments
export const runtimeDeployments = mysqlTable(
  'runtime_deployments',
  {
    id: varchar('id', { length: 36 })
      .primaryKey()
      .$defaultFn(() => crypto.randomUUID()),
    worldId: varchar('world_id', { length: 36 })
      .notNull()
      .references(() => worlds.id, { onDelete: 'cascade' }),
    runtimeMode: varchar('runtime_mode', { length: 255 }).notNull().default('LOGICAL'),
    topologyVersion: int('topology_version').notNull().default(1),
    status: varchar('status', { length: 255 }).notNull().default('PENDING'),
    errorMessage: text('error_message'),
    deployedAt: datetime('deployed_at', { mode: 'date', fsp: 3 })
      .notNull()
      .$defaultFn(() => new Date()),
    terminatedAt: datetime('terminated_at', { mode: 'date', fsp: 3 }),
  },
  (table) => [index('idx_deployments_world').on(table.worldId, table.status)],
);

// 2. Container instances
export const containerInstances = mysqlTable(
  'container_instances',
  {
    id: varchar('id', { length: 36 })
      .primaryKey()
      .$defaultFn(() => crypto.randomUUID()),
    worldId: varchar('world_id', { length: 36 })
      .notNull()
      .references(() => worlds.id, { onDelete: 'cascade' }),
    deploymentId: varchar('deployment_id', { length: 36 })
      .notNull()
      .references(() => runtimeDeployments.id, { onDelete: 'cascade' }),
    serviceId: varchar('service_id', { length: 36 })
      .notNull()
      .references(() => services.id, { onDelete: 'cascade' }),
    dockerContainerId: varchar('docker_container_id', { length: 36 }).notNull(),
    dockerImage: varchar('docker_image', { length: 255 }).notNull(),
    servicePort: int('service_port').notNull(),
    adminPort: int('admin_port').notNull(),
    toxiproxyPort: int('toxiproxy_port'),
    status: varchar('status', { length: 255 }).notNull().default('CREATED'),
    cpuLimitCores: decimal('cpu_limit_cores', { precision: 18, scale: 6 }).notNull().default('1.0'),
    memoryLimitMb: int('memory_limit_mb').notNull().default(256),
    startedAt: datetime('started_at', { mode: 'date', fsp: 3 }),
    stoppedAt: datetime('stopped_at', { mode: 'date', fsp: 3 }),
  },
  (table) => [
    unique('uq_service_deployment').on(table.deploymentId, table.serviceId),
    index('idx_containers_lookup').on(table.worldId, table.status),
    index('idx_containers_docker_id').on(table.dockerContainerId),
  ],
);

// 3. Edge proxy routing records
export const containerEdgeProxies = mysqlTable(
  'container_edge_proxies',
  {
    id: varchar('id', { length: 36 })
      .primaryKey()
      .$defaultFn(() => crypto.randomUUID()),
    deploymentId: varchar('deployment_id', { length: 36 })
      .notNull()
      .references(() => runtimeDeployments.id, { onDelete: 'cascade' }),
    edgeId: varchar('edge_id', { length: 36 })
      .notNull()
      .references(() => serviceDependencies.id, { onDelete: 'cascade' }),
    toxiproxyListenPort: int('toxiproxy_listen_port').notNull(),
    targetHost: varchar('target_host', { length: 255 }).notNull(),
    targetPort: int('target_port').notNull(),
    isActive: boolean('is_active').notNull().default(true),
    createdAt: datetime('created_at', { mode: 'date', fsp: 3 })
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
