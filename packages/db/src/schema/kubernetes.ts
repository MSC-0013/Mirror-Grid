import { sqliteTable, text, integer, real, index } from 'drizzle-orm/sqlite-core';
import { relations } from 'drizzle-orm';
import { worlds } from './core.js';

export const k8sClusters = sqliteTable('k8s_clusters', {
  id: text('id')
    .primaryKey()
    .$defaultFn(() => crypto.randomUUID()),
  name: text('name').notNull().unique(),
  apiServerUrl: text('api_server_url').notNull(),
  kubeconfigContext: text('kubeconfig_context'),
  clusterVersion: text('cluster_version'),
  isActive: integer('is_active', { mode: 'boolean' }).notNull().default(true),
  createdAt: integer('created_at', { mode: 'timestamp_ms' })
    .notNull()
    .$defaultFn(() => new Date()),
});

export const k8sDeployments = sqliteTable(
  'k8s_deployments',
  {
    id: text('id')
      .primaryKey()
      .$defaultFn(() => crypto.randomUUID()),
    worldId: text('world_id')
      .notNull()
      .references(() => worlds.id, { onDelete: 'cascade' }),
    clusterId: text('cluster_id')
      .notNull()
      .references(() => k8sClusters.id, { onDelete: 'cascade' }),
    namespace: text('namespace').notNull().unique(),
    status: text('status', {
      enum: ['PROVISIONING', 'RUNNING', 'DEGRADED', 'TERMINATING', 'TERMINATED'],
    })
      .notNull()
      .default('PROVISIONING'),
    totalDeployments: integer('total_deployments').notNull().default(0),
    totalPods: integer('total_pods').notNull().default(0),
    healthyPods: integer('healthy_pods').notNull().default(0),
    deployedAt: integer('deployed_at', { mode: 'timestamp_ms' })
      .notNull()
      .$defaultFn(() => new Date()),
    terminatedAt: integer('terminated_at', { mode: 'timestamp_ms' }),
  },
  (table) => [index('idx_k8s_deployments_world').on(table.worldId, table.status)],
);

export const k8sChaosEvents = sqliteTable(
  'k8s_chaos_events',
  {
    id: text('id')
      .primaryKey()
      .$defaultFn(() => crypto.randomUUID()),
    deploymentId: text('deployment_id')
      .notNull()
      .references(() => k8sDeployments.id, { onDelete: 'cascade' }),
    chaosType: text('chaos_type', {
      enum: ['POD_KILL', 'OOM_KILL', 'ROLLING_UPDATE', 'NODE_CORDON', 'NETWORK_ISOLATION'],
    }).notNull(),
    targetServiceName: text('target_service_name').notNull(),
    targetPodName: text('target_pod_name').notNull(),
    trafficOfferedRps: integer('traffic_offered_rps').notNull().default(0),
    requestsSuccessful: integer('requests_successful').notNull().default(0),
    requestsFailed: integer('requests_failed').notNull().default(0),
    availabilityPercentage: real('availability_percentage').notNull(),
    startedAt: integer('started_at', { mode: 'timestamp_ms' })
      .notNull()
      .$defaultFn(() => new Date()),
    completedAt: integer('completed_at', { mode: 'timestamp_ms' }),
    status: text('status').notNull().default('RUNNING'),
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
