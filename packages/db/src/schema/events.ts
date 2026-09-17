import { mysqlTable, varchar, text, int, json, datetime, index, primaryKey, unique } from 'drizzle-orm/mysql-core';
import { relations } from 'drizzle-orm';
import { worlds } from './core.js';

export const outboxEvents = mysqlTable(
  'outbox_events',
  {
    id: varchar('id', { length: 36 })
      .primaryKey()
      .$defaultFn(() => crypto.randomUUID()),
    worldId: varchar('world_id', { length: 36 })
      .notNull()
      .references(() => worlds.id, { onDelete: 'cascade' }),
    aggregateType: varchar('aggregate_type', { length: 255 }).notNull(),
    aggregateId: varchar('aggregate_id', { length: 36 }).notNull(),
    eventType: varchar('event_type', { length: 255 }).notNull(),
    partitionKey: varchar('partition_key', { length: 255 }).notNull(),
    sequenceNum: int('sequence_num').notNull(),
    payload: json('payload')
      .$type<Record<string, unknown>>()
      .notNull()
      .$defaultFn(() => ({})),
    headers: json('headers')
      .$type<Record<string, unknown>>()
      .notNull()
      .$defaultFn(() => ({})),
    createdAt: datetime('created_at', { mode: 'date', fsp: 3 })
      .notNull()
      .$defaultFn(() => new Date()),
    publishedAt: datetime('published_at', { mode: 'date', fsp: 3 }),
  },
  (table) => [
    index('idx_outbox_unprocessed').on(table.createdAt),
    index('idx_outbox_world_seq').on(table.worldId, table.sequenceNum),
  ],
);

export const consumedEvents = mysqlTable(
  'consumed_events',
  {
    eventId: varchar('event_id', { length: 36 }).notNull(),
    consumerGroup: varchar('consumer_group', { length: 255 }).notNull(),
    processedAt: datetime('processed_at', { mode: 'date', fsp: 3 })
      .notNull()
      .$defaultFn(() => new Date()),
  },
  (table) => [
    primaryKey({ columns: [table.eventId, table.consumerGroup] }),
    index('idx_consumed_events_date').on(table.processedAt),
  ],
);

export const worldActivityFeed = mysqlTable(
  'world_activity_feed',
  {
    id: varchar('id', { length: 36 })
      .primaryKey()
      .$defaultFn(() => crypto.randomUUID()),
    worldId: varchar('world_id', { length: 36 })
      .notNull()
      .references(() => worlds.id, { onDelete: 'cascade' }),
    eventId: varchar('event_id', { length: 36 }).notNull(),
    eventType: varchar('event_type', { length: 255 }).notNull(),
    actorEmail: varchar('actor_email', { length: 255 }),
    severity: varchar('severity', { length: 64, enum: ['INFO', 'WARNING', 'CRITICAL'] })
      .notNull()
      .default('INFO'),
    summary: text('summary').notNull(),
    details: json('details')
      .$type<Record<string, unknown>>()
      .notNull()
      .$defaultFn(() => ({})),
    occurredAt: datetime('occurred_at', { mode: 'date', fsp: 3 })
      .notNull()
      .$defaultFn(() => new Date()),
    createdAt: datetime('created_at', { mode: 'date', fsp: 3 })
      .notNull()
      .$defaultFn(() => new Date()),
  },
  (table) => [index('idx_activity_feed_world').on(table.worldId, table.occurredAt)],
);

export const eventStore = mysqlTable(
  'event_store',
  {
    seqNum: int('seq_num').autoincrement().primaryKey(),
    eventId: varchar('event_id', { length: 36 }).notNull().unique(),
    streamId: varchar('stream_id', { length: 36 }).notNull(),
    streamVersion: int('stream_version').notNull(),
    eventType: varchar('event_type', { length: 255 }).notNull(),
    payload: json('payload')
      .$type<Record<string, unknown>>()
      .notNull(),
    metadata: json('metadata')
      .$type<Record<string, unknown>>()
      .notNull()
      .$defaultFn(() => ({})),
    occurredAt: datetime('occurred_at', { mode: 'date', fsp: 3 })
      .notNull()
      .$defaultFn(() => new Date()),
  },
  (table) => [
    unique('uq_stream_version').on(table.streamId, table.streamVersion),
    index('idx_event_store_stream').on(table.streamId, table.streamVersion),
  ],
);

export const projectionCheckpoints = mysqlTable('projection_checkpoints', {
  projectionName: varchar('projection_name', { length: 255 }).primaryKey(),
  lastProcessedSeq: int('last_processed_seq').notNull().default(0),
  updatedAt: datetime('updated_at', { mode: 'date', fsp: 3 })
    .notNull()
    .$defaultFn(() => new Date()),
});

export const outboxEventsRelations = relations(outboxEvents, ({ one }) => ({
  world: one(worlds, {
    fields: [outboxEvents.worldId],
    references: [worlds.id],
  }),
}));

export const worldActivityFeedRelations = relations(worldActivityFeed, ({ one }) => ({
  world: one(worlds, {
    fields: [worldActivityFeed.worldId],
    references: [worlds.id],
  }),
}));
