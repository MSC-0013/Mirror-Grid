import { mysqlTable, varchar, text, int, double, json, datetime, index } from 'drizzle-orm/mysql-core';
import { relations } from 'drizzle-orm';
import { worlds } from './core.js';
import { services } from './topology.js';

export const traceSpans = mysqlTable(
  'trace_spans',
  {
    id: varchar('id', { length: 36 })
      .primaryKey()
      .$defaultFn(() => crypto.randomUUID()),
    worldId: varchar('world_id', { length: 36 })
      .notNull()
      .references(() => worlds.id, { onDelete: 'cascade' }),
    traceId: varchar('trace_id', { length: 36 }).notNull(),
    spanId: varchar('span_id', { length: 36 }).notNull(),
    parentSpanId: varchar('parent_span_id', { length: 36 }),
    serviceId: varchar('service_id', { length: 36 }).references(() => services.id, { onDelete: 'set null' }),
    serviceName: varchar('service_name', { length: 255 }).notNull(),
    operationName: varchar('operation_name', { length: 255 }).notNull(),
    spanKind: varchar('span_kind', { length: 64, enum: ['SERVER', 'CLIENT', 'PRODUCER', 'CONSUMER', 'INTERNAL'] })
      .notNull()
      .default('INTERNAL'),
    startTimeMicros: int('start_time_micros').notNull(),
    durationMicros: int('duration_micros').notNull(),
    statusCode: varchar('status_code', { length: 64, enum: ['OK', 'ERROR', 'UNSET'] })
      .notNull()
      .default('OK'),
    statusMessage: text('status_message'),
    attributes: json('attributes')
      .$type<Record<string, unknown>>()
      .notNull()
      .$defaultFn(() => ({})),
    events: json('events')
      .$type<unknown[]>()
      .notNull()
      .$defaultFn(() => []),
    createdAt: datetime('created_at', { mode: 'date', fsp: 3 })
      .notNull()
      .$defaultFn(() => new Date()),
  },
  (table) => [
    index('idx_spans_trace').on(table.traceId, table.startTimeMicros),
    index('idx_spans_world_time').on(table.worldId, table.startTimeMicros),
    index('idx_spans_service').on(table.serviceName, table.startTimeMicros),
  ],
);

export const metricsSnapshots = mysqlTable(
  'metrics_snapshots',
  {
    id: varchar('id', { length: 36 })
      .primaryKey()
      .$defaultFn(() => crypto.randomUUID()),
    worldId: varchar('world_id', { length: 36 })
      .notNull()
      .references(() => worlds.id, { onDelete: 'cascade' }),
    serviceId: varchar('service_id', { length: 36 }).references(() => services.id, { onDelete: 'cascade' }),
    metricTimestamp: datetime('metric_timestamp', { mode: 'date', fsp: 3 }).notNull(),
    metricName: varchar('metric_name', { length: 255 }).notNull(),
    labels: json('labels')
      .$type<Record<string, string>>()
      .notNull()
      .$defaultFn(() => ({})),
    valueCount: int('value_count').notNull(),
    valueSum: double('value_sum').notNull(),
    p50Ms: double('p50_ms'),
    p95Ms: double('p95_ms'),
    p99Ms: double('p99_ms'),
    createdAt: datetime('created_at', { mode: 'date', fsp: 3 })
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
