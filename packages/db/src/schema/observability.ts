import { sqliteTable, text, integer, real, index } from 'drizzle-orm/sqlite-core';
import { relations } from 'drizzle-orm';
import { worlds } from './core.js';
import { services } from './topology.js';

export const traceSpans = sqliteTable(
  'trace_spans',
  {
    id: text('id')
      .primaryKey()
      .$defaultFn(() => crypto.randomUUID()),
    worldId: text('world_id')
      .notNull()
      .references(() => worlds.id, { onDelete: 'cascade' }),
    traceId: text('trace_id').notNull(),
    spanId: text('span_id').notNull(),
    parentSpanId: text('parent_span_id'),
    serviceId: text('service_id').references(() => services.id, { onDelete: 'set null' }),
    serviceName: text('service_name').notNull(),
    operationName: text('operation_name').notNull(),
    spanKind: text('span_kind', {
      enum: ['SERVER', 'CLIENT', 'PRODUCER', 'CONSUMER', 'INTERNAL'],
    })
      .notNull()
      .default('INTERNAL'),
    startTimeMicros: integer('start_time_micros').notNull(),
    durationMicros: integer('duration_micros').notNull(),
    statusCode: text('status_code', {
      enum: ['OK', 'ERROR', 'UNSET'],
    })
      .notNull()
      .default('OK'),
    statusMessage: text('status_message'),
    attributes: text('attributes', { mode: 'json' })
      .$type<Record<string, unknown>>()
      .notNull()
      .$defaultFn(() => ({})),
    events: text('events', { mode: 'json' })
      .$type<unknown[]>()
      .notNull()
      .$defaultFn(() => []),
    createdAt: integer('created_at', { mode: 'timestamp_ms' })
      .notNull()
      .$defaultFn(() => new Date()),
  },
  (table) => [
    index('idx_spans_trace').on(table.traceId, table.startTimeMicros),
    index('idx_spans_world_time').on(table.worldId, table.startTimeMicros),
    index('idx_spans_service').on(table.serviceName, table.startTimeMicros),
  ],
);

export const metricsSnapshots = sqliteTable(
  'metrics_snapshots',
  {
    id: text('id')
      .primaryKey()
      .$defaultFn(() => crypto.randomUUID()),
    worldId: text('world_id')
      .notNull()
      .references(() => worlds.id, { onDelete: 'cascade' }),
    serviceId: text('service_id').references(() => services.id, { onDelete: 'cascade' }),
    metricTimestamp: integer('metric_timestamp', { mode: 'timestamp_ms' }).notNull(),
    metricName: text('metric_name').notNull(),
    labels: text('labels', { mode: 'json' })
      .$type<Record<string, string>>()
      .notNull()
      .$defaultFn(() => ({})),
    valueCount: integer('value_count').notNull(),
    valueSum: real('value_sum').notNull(),
    p50Ms: real('p50_ms'),
    p95Ms: real('p95_ms'),
    p99Ms: real('p99_ms'),
    createdAt: integer('created_at', { mode: 'timestamp_ms' })
      .notNull()
      .$defaultFn(() => new Date()),
  },
  (table) => [
    index('idx_metrics_query').on(
      table.worldId,
      table.serviceId,
      table.metricName,
      table.metricTimestamp,
    ),
  ],
);

export const traceSpansRelations = relations(traceSpans, ({ one }) => ({
  world: one(worlds, {
    fields: [traceSpans.worldId],
    references: [worlds.id],
  }),
  service: one(services, {
    fields: [traceSpans.serviceId],
    references: [services.id],
  }),
}));

export const metricsSnapshotsRelations = relations(metricsSnapshots, ({ one }) => ({
  world: one(worlds, {
    fields: [metricsSnapshots.worldId],
    references: [worlds.id],
  }),
  service: one(services, {
    fields: [metricsSnapshots.serviceId],
    references: [services.id],
  }),
}));
