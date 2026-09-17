import { mysqlTable, varchar, text, int, double, json, datetime, index, uniqueIndex } from 'drizzle-orm/mysql-core';
import { relations } from 'drizzle-orm';
import { worlds } from './core.js';
import { services } from './topology.js';

export const serviceSlos = mysqlTable(
  'service_slos',
  {
    id: varchar('id', { length: 36 })
      .primaryKey()
      .$defaultFn(() => crypto.randomUUID()),
    worldId: varchar('world_id', { length: 36 })
      .notNull()
      .references(() => worlds.id, { onDelete: 'cascade' }),
    serviceId: varchar('service_id', { length: 36 })
      .notNull()
      .references(() => services.id, { onDelete: 'cascade' }),
    name: varchar('name', { length: 255 }).notNull(),
    sliType: varchar('sli_type', { length: 64, enum: ['AVAILABILITY', 'LATENCY_P99', 'LATENCY_P95'] }).notNull(),
    targetPercentage: double('target_percentage').notNull(),
    windowSeconds: int('window_seconds').notNull().default(2592000),
    thresholdLatencyMicros: int('threshold_latency_micros'),
    createdAt: datetime('created_at', { mode: 'date', fsp: 3 })
      .notNull()
      .$defaultFn(() => new Date()),
    updatedAt: datetime('updated_at', { mode: 'date', fsp: 3 })
      .notNull()
      .$defaultFn(() => new Date()),
  },
  (table) => [
    index('idx_slos_world').on(table.worldId),
    uniqueIndex('uq_service_slo_name').on(table.serviceId, table.name),
  ],
);

export const sloBurnEvents = mysqlTable(
  'slo_burn_events',
  {
    id: varchar('id', { length: 36 })
      .primaryKey()
      .$defaultFn(() => crypto.randomUUID()),
    sloId: varchar('slo_id', { length: 36 })
      .notNull()
      .references(() => serviceSlos.id, { onDelete: 'cascade' }),
    burnRate: double('burn_rate').notNull(),
    severity: varchar('severity', { length: 64, enum: ['P1_CRITICAL', 'P2_HIGH', 'P3_WARNING'] }).notNull(),
    longWindowSeconds: int('long_window_seconds').notNull(),
    shortWindowSeconds: int('short_window_seconds').notNull(),
    budgetConsumedPercent: double('budget_consumed_percent').notNull(),
    triggeredAt: datetime('triggered_at', { mode: 'date', fsp: 3 })
      .notNull()
      .$defaultFn(() => new Date()),
    resolvedAt: datetime('resolved_at', { mode: 'date', fsp: 3 }),
  },
  (table) => [
    index('idx_burn_events_slo').on(table.sloId, table.triggeredAt),
  ],
);

export const rcaInvestigations = mysqlTable(
  'rca_investigations',
  {
    id: varchar('id', { length: 36 })
      .primaryKey()
      .$defaultFn(() => crypto.randomUUID()),
    worldId: varchar('world_id', { length: 36 })
      .notNull()
      .references(() => worlds.id, { onDelete: 'cascade' }),
    experimentRunId: varchar('experiment_run_id', { length: 36 }),
    rootCauseServiceId: text('root_cause_service_id').references(() => services.id, {
      onDelete: 'set null',
    }),
    confidencePercentage: double('confidence_percentage').notNull(),
    failureType: varchar('failure_type', { length: 64, enum: [
        'LATENCY_INDUCED_SATURATION',
        'RESOURCE_STARVATION',
        'POISON_PILL',
        'CIRCUIT_TRIP_CASCADE',
      ] }).notNull(),
    causalChain: json('causal_chain')
      .$type<unknown[]>()
      .notNull()
      .$defaultFn(() => []),
    evidenceSummary: json('evidence_summary')
      .$type<Record<string, unknown>>()
      .notNull()
      .$defaultFn(() => ({})),
    createdAt: datetime('created_at', { mode: 'date', fsp: 3 })
      .notNull()
      .$defaultFn(() => new Date()),
  },
  (table) => [
    index('idx_rca_world').on(table.worldId, table.createdAt),
  ],
);

export const reliabilityReports = mysqlTable(
  'reliability_reports',
  {
    id: varchar('id', { length: 36 })
      .primaryKey()
      .$defaultFn(() => crypto.randomUUID()),
    worldId: varchar('world_id', { length: 36 })
      .notNull()
      .references(() => worlds.id, { onDelete: 'cascade' }),
    title: varchar('title', { length: 255 }).notNull(),
    timeRangeStart: datetime('time_range_start', { mode: 'date', fsp: 3 }).notNull(),
    timeRangeEnd: datetime('time_range_end', { mode: 'date', fsp: 3 }).notNull(),
    overallScore: double('overall_score').notNull(),
    errorBudgetConsumedPercent: double('error_budget_consumed_percent').notNull(),
    reportMarkdown: text('report_markdown').notNull(),
    createdAt: datetime('created_at', { mode: 'date', fsp: 3 })
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
