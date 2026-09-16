import { sqliteTable, text, integer, real, index, uniqueIndex } from 'drizzle-orm/sqlite-core';
import { relations } from 'drizzle-orm';
import { worlds } from './core.js';
import { services } from './topology.js';

export const serviceSlos = sqliteTable(
  'service_slos',
  {
    id: text('id')
      .primaryKey()
      .$defaultFn(() => crypto.randomUUID()),
    worldId: text('world_id')
      .notNull()
      .references(() => worlds.id, { onDelete: 'cascade' }),
    serviceId: text('service_id')
      .notNull()
      .references(() => services.id, { onDelete: 'cascade' }),
    name: text('name').notNull(),
    sliType: text('sli_type', {
      enum: ['AVAILABILITY', 'LATENCY_P99', 'LATENCY_P95'],
    }).notNull(),
    targetPercentage: real('target_percentage').notNull(),
    windowSeconds: integer('window_seconds').notNull().default(2592000),
    thresholdLatencyMicros: integer('threshold_latency_micros'),
    createdAt: integer('created_at', { mode: 'timestamp_ms' })
      .notNull()
      .$defaultFn(() => new Date()),
    updatedAt: integer('updated_at', { mode: 'timestamp_ms' })
      .notNull()
      .$defaultFn(() => new Date()),
  },
  (table) => [
    index('idx_slos_world').on(table.worldId),
    uniqueIndex('uq_service_slo_name').on(table.serviceId, table.name),
  ],
);

export const sloBurnEvents = sqliteTable(
  'slo_burn_events',
  {
    id: text('id')
      .primaryKey()
      .$defaultFn(() => crypto.randomUUID()),
    sloId: text('slo_id')
      .notNull()
      .references(() => serviceSlos.id, { onDelete: 'cascade' }),
    burnRate: real('burn_rate').notNull(),
    severity: text('severity', {
      enum: ['P1_CRITICAL', 'P2_HIGH', 'P3_WARNING'],
    }).notNull(),
    longWindowSeconds: integer('long_window_seconds').notNull(),
    shortWindowSeconds: integer('short_window_seconds').notNull(),
    budgetConsumedPercent: real('budget_consumed_percent').notNull(),
    triggeredAt: integer('triggered_at', { mode: 'timestamp_ms' })
      .notNull()
      .$defaultFn(() => new Date()),
    resolvedAt: integer('resolved_at', { mode: 'timestamp_ms' }),
  },
  (table) => [
    index('idx_burn_events_slo').on(table.sloId, table.triggeredAt),
  ],
);

export const rcaInvestigations = sqliteTable(
  'rca_investigations',
  {
    id: text('id')
      .primaryKey()
      .$defaultFn(() => crypto.randomUUID()),
    worldId: text('world_id')
      .notNull()
      .references(() => worlds.id, { onDelete: 'cascade' }),
    experimentRunId: text('experiment_run_id'),
    rootCauseServiceId: text('root_cause_service_id').references(() => services.id, {
      onDelete: 'set null',
    }),
    confidencePercentage: real('confidence_percentage').notNull(),
    failureType: text('failure_type', {
      enum: [
        'LATENCY_INDUCED_SATURATION',
        'RESOURCE_STARVATION',
        'POISON_PILL',
        'CIRCUIT_TRIP_CASCADE',
      ],
    }).notNull(),
    causalChain: text('causal_chain', { mode: 'json' })
      .$type<unknown[]>()
      .notNull()
      .$defaultFn(() => []),
    evidenceSummary: text('evidence_summary', { mode: 'json' })
      .$type<Record<string, unknown>>()
      .notNull()
      .$defaultFn(() => ({})),
    createdAt: integer('created_at', { mode: 'timestamp_ms' })
      .notNull()
      .$defaultFn(() => new Date()),
  },
  (table) => [
    index('idx_rca_world').on(table.worldId, table.createdAt),
  ],
);

export const reliabilityReports = sqliteTable(
  'reliability_reports',
  {
    id: text('id')
      .primaryKey()
      .$defaultFn(() => crypto.randomUUID()),
    worldId: text('world_id')
      .notNull()
      .references(() => worlds.id, { onDelete: 'cascade' }),
    title: text('title').notNull(),
    timeRangeStart: integer('time_range_start', { mode: 'timestamp_ms' }).notNull(),
    timeRangeEnd: integer('time_range_end', { mode: 'timestamp_ms' }).notNull(),
    overallScore: real('overall_score').notNull(),
    errorBudgetConsumedPercent: real('error_budget_consumed_percent').notNull(),
    reportMarkdown: text('report_markdown').notNull(),
    createdAt: integer('created_at', { mode: 'timestamp_ms' })
      .notNull()
      .$defaultFn(() => new Date()),
  },
  (table) => [
    index('idx_reports_world').on(table.worldId, table.createdAt),
  ],
);

export const serviceSlosRelations = relations(serviceSlos, ({ one, many }) => ({
  world: one(worlds, {
    fields: [serviceSlos.worldId],
    references: [worlds.id],
  }),
  service: one(services, {
    fields: [serviceSlos.serviceId],
    references: [services.id],
  }),
  burnEvents: many(sloBurnEvents),
}));

export const sloBurnEventsRelations = relations(sloBurnEvents, ({ one }) => ({
  slo: one(serviceSlos, {
    fields: [sloBurnEvents.sloId],
    references: [serviceSlos.id],
  }),
}));

export const rcaInvestigationsRelations = relations(rcaInvestigations, ({ one }) => ({
  world: one(worlds, {
    fields: [rcaInvestigations.worldId],
    references: [worlds.id],
  }),
  rootCauseService: one(services, {
    fields: [rcaInvestigations.rootCauseServiceId],
    references: [services.id],
  }),
}));

export const reliabilityReportsRelations = relations(reliabilityReports, ({ one }) => ({
  world: one(worlds, {
    fields: [reliabilityReports.worldId],
    references: [worlds.id],
  }),
}));
