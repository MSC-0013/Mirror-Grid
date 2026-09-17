import { mysqlTable, varchar, text, int, boolean, json, datetime, index, uniqueIndex } from 'drizzle-orm/mysql-core';
import { relations } from 'drizzle-orm';
import { worlds } from './core.js';
import { experimentRuns } from './runtime.js';

export const worldSnapshots = mysqlTable(
  'world_snapshots',
  {
    id: varchar('id', { length: 36 })
      .primaryKey()
      .$defaultFn(() => crypto.randomUUID()),
    worldId: varchar('world_id', { length: 36 })
      .notNull()
      .references(() => worlds.id, { onDelete: 'cascade' }),
    experimentRunId: varchar('experiment_run_id', { length: 36 }).references(() => experimentRuns.id, {
      onDelete: 'cascade',
    }),
    simTimeMicros: int('sim_time_micros').notNull(),
    sequenceNum: int('sequence_num').notNull(),
    merkleRootHash: varchar('merkle_root_hash', { length: 64 }).notNull(),
    snapshotType: varchar('snapshot_type', { length: 64, enum: ['PERIODIC', 'TRIGGERED', 'MANUAL', 'PRE_FAULT'] })
      .notNull()
      .default('PERIODIC'),
    triggerReason: text('trigger_reason'),
    totalComponents: int('total_components').notNull(),
    deduplicatedComponents: int('deduplicated_components').notNull(),
    sizeBytes: int('size_bytes').notNull().default(0),
    createdAt: datetime('created_at', { mode: 'date', fsp: 3 })
      .notNull()
      .$defaultFn(() => new Date()),
  },
  (table) => [
    index('idx_snapshots_world_time').on(table.worldId, table.simTimeMicros),
    index('idx_snapshots_run').on(table.experimentRunId, table.sequenceNum),
  ],
);

export const snapshotComponents = mysqlTable(
  'snapshot_components',
  {
    id: varchar('id', { length: 36 })
      .primaryKey()
      .$defaultFn(() => crypto.randomUUID()),
    snapshotId: varchar('snapshot_id', { length: 36 })
      .notNull()
      .references(() => worldSnapshots.id, { onDelete: 'cascade' }),
    componentType: varchar('component_type', { length: 64, enum: ['SERVICE_STATE', 'CIRCUIT_BREAKER', 'QUEUE_STATE', 'FAULT_STATE'] }).notNull(),
    componentId: varchar('component_id', { length: 36 }).notNull(),
    componentHash: varchar('component_hash', { length: 64 }).notNull(),
    statePayload: json('state_payload')
      .$type<Record<string, unknown>>()
      .notNull()
      .$defaultFn(() => ({})),
    isDeduplicated: boolean('is_deduplicated')
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

export const drRestorations = mysqlTable(
  'dr_restorations',
  {
    id: varchar('id', { length: 36 })
      .primaryKey()
      .$defaultFn(() => crypto.randomUUID()),
    worldId: varchar('world_id', { length: 36 })
      .notNull()
      .references(() => worlds.id, { onDelete: 'cascade' }),
    snapshotId: varchar('snapshot_id', { length: 36 })
      .notNull()
      .references(() => worldSnapshots.id, { onDelete: 'cascade' }),
    restoreStatus: varchar('restore_status', { length: 64, enum: ['IN_PROGRESS', 'COMPLETED', 'FAILED'] })
      .notNull()
      .default('IN_PROGRESS'),
    rpoMicros: int('rpo_micros').notNull(),
    rtoMs: int('rto_ms').notNull(),
    verificationHashMatch: boolean('verification_hash_match')
      .notNull()
      .default(false),
    errorMessage: text('error_message'),
    restoredBy: varchar('restored_by', { length: 36 }).notNull(),
    createdAt: datetime('created_at', { mode: 'date', fsp: 3 })
      .notNull()
      .$defaultFn(() => new Date()),
    completedAt: datetime('completed_at', { mode: 'date', fsp: 3 }),
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
