import { sqliteTable, text, integer, index, primaryKey, unique } from 'drizzle-orm/sqlite-core';
import { relations } from 'drizzle-orm';
import { worlds } from './core.js';

export const outboxEvents = sqliteTable(
  'outbox_events',
  {
    id: text('id')
      .primaryKey()
      .$defaultFn(() => crypto.randomUUID()),
    worldId: text('world_id')
      .notNull()
      .references(() => worlds.id, { onDelete: 'cascade' }),
    aggregateType: text('aggregate_type').notNull(),
    aggregateId: text('aggregate_id').notNull(),
    eventType: text('event_type').notNull(),
    partitionKey: text('partition_key').notNull(),
    sequenceNum: integer('sequence_num').notNull(),
    payload: text('payload', { mode: 'json' })
      .$type<Record<string, unknown>>()
      .notNull()
      .$defaultFn(() => ({})),
    headers: text('headers', { mode: 'json' })
      .$type<Record<string, unknown>>()
      .notNull()
      .$defaultFn(() => ({})),
    createdAt: integer('created_at', { mode: 'timestamp_ms' })
      .notNull()
      .$defaultFn(() => new Date()),
    publishedAt: integer('published_at', { mode: 'timestamp_ms' }),
  },
  (table) => [
    index('idx_outbox_unprocessed').on(table.createdAt),
    index('idx_outbox_world_seq').on(table.worldId, table.sequenceNum),
  ],
);

export const consumedEvents = sqliteTable(
  'consumed_events',
  {
    eventId: text('event_id').notNull(),
    consumerGroup: text('consumer_group').notNull(),
    processedAt: integer('processed_at', { mode: 'timestamp_ms' })
      .notNull()
      .$defaultFn(() => new Date()),
  },
  (table) => [
    primaryKey({ columns: [table.eventId, table.consumerGroup] }),
    index('idx_consumed_events_date').on(table.processedAt),
  ],
);

export const worldActivityFeed = sqliteTable(
  'world_activity_feed',
  {
    id: text('id')
      .primaryKey()
      .$defaultFn(() => crypto.randomUUID()),
    worldId: text('world_id')
      .notNull()
      .references(() => worlds.id, { onDelete: 'cascade' }),
    eventId: text('event_id').notNull(),
    eventType: text('event_type').notNull(),
    actorEmail: text('actor_email'),
    severity: text('severity', { enum: ['INFO', 'WARNING', 'CRITICAL'] })
      .notNull()
      .default('INFO'),
    summary: text('summary').notNull(),
    details: text('details', { mode: 'json' })
      .$type<Record<string, unknown>>()
      .notNull()
      .$defaultFn(() => ({})),
    occurredAt: integer('occurred_at', { mode: 'timestamp_ms' })
      .notNull()
      .$defaultFn(() => new Date()),
    createdAt: integer('created_at', { mode: 'timestamp_ms' })
      .notNull()
      .$defaultFn(() => new Date()),
  },
  (table) => [index('idx_activity_feed_world').on(table.worldId, table.occurredAt)],
);

export const eventStore = sqliteTable(
  'event_store',
  {
    seqNum: integer('seq_num').primaryKey({ autoIncrement: true }),
    eventId: text('event_id').notNull().unique(),
    streamId: text('stream_id').notNull(),
    streamVersion: integer('stream_version').notNull(),
    eventType: text('event_type').notNull(),
    payload: text('payload', { mode: 'json' })
      .$type<Record<string, unknown>>()
      .notNull(),
    metadata: text('metadata', { mode: 'json' })
      .$type<Record<string, unknown>>()
      .notNull()
      .$defaultFn(() => ({})),
    occurredAt: integer('occurred_at', { mode: 'timestamp_ms' })
      .notNull()
      .$defaultFn(() => new Date()),
  },
  (table) => [
    unique('uq_stream_version').on(table.streamId, table.streamVersion),
    index('idx_event_store_stream').on(table.streamId, table.streamVersion),
  ],
);

export const projectionCheckpoints = sqliteTable('projection_checkpoints', {
  projectionName: text('projection_name').primaryKey(),
  lastProcessedSeq: integer('last_processed_seq').notNull().default(0),
  updatedAt: integer('updated_at', { mode: 'timestamp_ms' })
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
