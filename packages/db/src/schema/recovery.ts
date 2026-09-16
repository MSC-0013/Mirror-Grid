import { sqliteTable, text, integer, index, uniqueIndex } from 'drizzle-orm/sqlite-core';
import { relations } from 'drizzle-orm';
import { worlds } from './core.js';
import { experimentRuns } from './runtime.js';

export const worldSnapshots = sqliteTable(
  'world_snapshots',
  {
    id: text('id')
      .primaryKey()
      .$defaultFn(() => crypto.randomUUID()),
    worldId: text('world_id')
      .notNull()
      .references(() => worlds.id, { onDelete: 'cascade' }),
    experimentRunId: text('experiment_run_id').references(() => experimentRuns.id, {
      onDelete: 'cascade',
    }),
    simTimeMicros: integer('sim_time_micros').notNull(),
    sequenceNum: integer('sequence_num').notNull(),
    merkleRootHash: text('merkle_root_hash').notNull(),
    snapshotType: text('snapshot_type', {
      enum: ['PERIODIC', 'TRIGGERED', 'MANUAL', 'PRE_FAULT'],
    })
      .notNull()
      .default('PERIODIC'),
    triggerReason: text('trigger_reason'),
    totalComponents: integer('total_components').notNull(),
    deduplicatedComponents: integer('deduplicated_components').notNull(),
    sizeBytes: integer('size_bytes').notNull().default(0),
    createdAt: integer('created_at', { mode: 'timestamp_ms' })
      .notNull()
      .$defaultFn(() => new Date()),
  },
  (table) => [
    index('idx_snapshots_world_time').on(table.worldId, table.simTimeMicros),
    index('idx_snapshots_run').on(table.experimentRunId, table.sequenceNum),
  ],
);

export const snapshotComponents = sqliteTable(
  'snapshot_components',
  {
    id: text('id')
      .primaryKey()
      .$defaultFn(() => crypto.randomUUID()),
    snapshotId: text('snapshot_id')
      .notNull()
      .references(() => worldSnapshots.id, { onDelete: 'cascade' }),
    componentType: text('component_type', {
      enum: ['SERVICE_STATE', 'CIRCUIT_BREAKER', 'QUEUE_STATE', 'FAULT_STATE'],
    }).notNull(),
    componentId: text('component_id').notNull(),
    componentHash: text('component_hash').notNull(),
    statePayload: text('state_payload', { mode: 'json' })
      .$type<Record<string, unknown>>()
      .notNull()
      .$defaultFn(() => ({})),
    isDeduplicated: integer('is_deduplicated', { mode: 'boolean' })
      .notNull()
      .default(false),
  },
  (table) => [
    uniqueIndex('uq_snapshot_component').on(
      table.snapshotId,
      table.componentType,
      table.componentId,
    ),
    index('idx_components_lookup').on(table.componentHash),
  ],
);

export const drRestorations = sqliteTable(
  'dr_restorations',
  {
    id: text('id')
      .primaryKey()
      .$defaultFn(() => crypto.randomUUID()),
    worldId: text('world_id')
      .notNull()
      .references(() => worlds.id, { onDelete: 'cascade' }),
    snapshotId: text('snapshot_id')
      .notNull()
      .references(() => worldSnapshots.id, { onDelete: 'cascade' }),
    restoreStatus: text('restore_status', {
      enum: ['IN_PROGRESS', 'COMPLETED', 'FAILED'],
    })
      .notNull()
      .default('IN_PROGRESS'),
    rpoMicros: integer('rpo_micros').notNull(),
    rtoMs: integer('rto_ms').notNull(),
    verificationHashMatch: integer('verification_hash_match', { mode: 'boolean' })
      .notNull()
      .default(false),
    errorMessage: text('error_message'),
    restoredBy: text('restored_by').notNull(),
    createdAt: integer('created_at', { mode: 'timestamp_ms' })
      .notNull()
      .$defaultFn(() => new Date()),
    completedAt: integer('completed_at', { mode: 'timestamp_ms' }),
  },
  (table) => [
    index('idx_dr_world').on(table.worldId, table.createdAt),
  ],
);

export const worldSnapshotsRelations = relations(worldSnapshots, ({ one, many }) => ({
  world: one(worlds, {
    fields: [worldSnapshots.worldId],
    references: [worlds.id],
  }),
  components: many(snapshotComponents),
  restorations: many(drRestorations),
}));

export const snapshotComponentsRelations = relations(snapshotComponents, ({ one }) => ({
  snapshot: one(worldSnapshots, {
    fields: [snapshotComponents.snapshotId],
    references: [worldSnapshots.id],
  }),
}));

export const drRestorationsRelations = relations(drRestorations, ({ one }) => ({
  world: one(worlds, {
    fields: [drRestorations.worldId],
    references: [worlds.id],
  }),
  snapshot: one(worldSnapshots, {
    fields: [drRestorations.snapshotId],
    references: [worldSnapshots.id],
  }),
}));
