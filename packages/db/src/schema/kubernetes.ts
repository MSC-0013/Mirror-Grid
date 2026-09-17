import { mysqlTable, varchar, text, int, double, boolean, datetime, index } from 'drizzle-orm/mysql-core';
import { relations } from 'drizzle-orm';
import { worlds } from './core.js';

export const k8sClusters = mysqlTable('k8s_clusters', {
  id: varchar('id', { length: 36 })
    .primaryKey()
    .$defaultFn(() => crypto.randomUUID()),
  name: varchar('name', { length: 255 }).notNull().unique(),
  apiServerUrl: varchar('api_server_url', { length: 255 }).notNull(),
  kubeconfigContext: text('kubeconfig_context'),
  clusterVersion: varchar('cluster_version', { length: 255 }),
  isActive: boolean('is_active').notNull().default(true),
  createdAt: datetime('created_at', { mode: 'date', fsp: 3 })
    .notNull()
    .$defaultFn(() => new Date()),
});

export const k8sDeployments = mysqlTable(
  'k8s_deployments',
  {
    id: varchar('id', { length: 36 })
      .primaryKey()
      .$defaultFn(() => crypto.randomUUID()),
    worldId: varchar('world_id', { length: 36 })
      .notNull()
      .references(() => worlds.id, { onDelete: 'cascade' }),
    clusterId: varchar('cluster_id', { length: 36 })
      .notNull()
      .references(() => k8sClusters.id, { onDelete: 'cascade' }),
    namespace: varchar('namespace', { length: 255 }).notNull().unique(),
    status: varchar('status', { length: 64, enum: ['PROVISIONING', 'RUNNING', 'DEGRADED', 'TERMINATING', 'TERMINATED'] })
      .notNull()
      .default('PROVISIONING'),
    totalDeployments: int('total_deployments').notNull().default(0),
    totalPods: int('total_pods').notNull().default(0),
    healthyPods: int('healthy_pods').notNull().default(0),
    deployedAt: datetime('deployed_at', { mode: 'date', fsp: 3 })
      .notNull()
      .$defaultFn(() => new Date()),
    terminatedAt: datetime('terminated_at', { mode: 'date', fsp: 3 }),
  },
  (table) => [index('idx_k8s_deployments_world').on(table.worldId, table.status)],
);

export const k8sChaosEvents = mysqlTable(
  'k8s_chaos_events',
  {
    id: varchar('id', { length: 36 })
      .primaryKey()
      .$defaultFn(() => crypto.randomUUID()),
    deploymentId: varchar('deployment_id', { length: 36 })
      .notNull()
      .references(() => k8sDeployments.id, { onDelete: 'cascade' }),
    chaosType: varchar('chaos_type', { length: 64, enum: ['POD_KILL', 'OOM_KILL', 'ROLLING_UPDATE', 'NODE_CORDON', 'NETWORK_ISOLATION'] }).notNull(),
    targetServiceName: varchar('target_service_name', { length: 255 }).notNull(),
    targetPodName: varchar('target_pod_name', { length: 255 }).notNull(),
    trafficOfferedRps: int('traffic_offered_rps').notNull().default(0),
    requestsSuccessful: int('requests_successful').notNull().default(0),
    requestsFailed: int('requests_failed').notNull().default(0),
    availabilityPercentage: double('availability_percentage').notNull(),
    startedAt: datetime('started_at', { mode: 'date', fsp: 3 })
      .notNull()
      .$defaultFn(() => new Date()),
    completedAt: datetime('completed_at', { mode: 'date', fsp: 3 }),
    status: varchar('status', { length: 255 }).notNull().default('RUNNING'),
  },
  (table) => [index('idx_k8s_chaos_deployment').on(table.deploymentId, table.startedAt)],
);

export const k8sClustersRelations = relations(k8sClusters, ({ many }) => ({
  deployments: many(k8sDeployments),
}));

export const k8sDeploymentsRelations = relations(k8sDeployments, ({ one, many }) => ({
  world: one(worlds, {
    fields: [k8sDeployments.worldId],
    references: [worlds.id],
  }),
  cluster: one(k8sClusters, {
    fields: [k8sDeployments.clusterId],
    references: [k8sClusters.id],
  }),
  chaosEvents: many(k8sChaosEvents),
}));

export const k8sChaosEventsRelations = relations(k8sChaosEvents, ({ one }) => ({
  deployment: one(k8sDeployments, {
    fields: [k8sChaosEvents.deploymentId],
    references: [k8sDeployments.id],
  }),
}));
