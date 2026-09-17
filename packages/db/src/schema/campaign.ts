import { mysqlTable, varchar, text, int, double, datetime, index } from 'drizzle-orm/mysql-core';
import { relations } from 'drizzle-orm';
import { worlds } from './core.js';

export const campaignRuns = mysqlTable(
  'campaign_runs',
  {
    id: varchar('id', { length: 36 })
      .primaryKey()
      .$defaultFn(() => crypto.randomUUID()),
    worldId: varchar('world_id', { length: 36 })
      .notNull()
      .references(() => worlds.id, { onDelete: 'cascade' }),
    totalScenarios: int('total_scenarios').notNull().default(20),
    passedScenarios: int('passed_scenarios').notNull().default(0),
    failedScenarios: int('failed_scenarios').notNull().default(0),
    totalThroughputRps: double('total_throughput_rps').notNull().default(0.0),
    p99LatencyMs: double('p99_latency_ms').notNull().default(0.0),
    heapDeltaBytes: int('heap_delta_bytes').notNull().default(0),
    status: varchar('status', { length: 64, enum: ['RUNNING', 'COMPLETED', 'FAILED'] })
      .notNull()
      .default('RUNNING'),
    startedAt: datetime('started_at', { mode: 'date', fsp: 3 })
      .notNull()
      .$defaultFn(() => new Date()),
    completedAt: datetime('completed_at', { mode: 'date', fsp: 3 }),
  },
  (table) => [index('idx_campaign_runs_world').on(table.worldId, table.status)],
);

export const campaignScenarios = mysqlTable(
  'campaign_scenarios',
  {
    id: varchar('id', { length: 36 })
      .primaryKey()
      .$defaultFn(() => crypto.randomUUID()),
    campaignId: varchar('campaign_id', { length: 36 })
      .notNull()
      .references(() => campaignRuns.id, { onDelete: 'cascade' }),
    scenarioNumber: int('scenario_number').notNull(),
    name: varchar('name', { length: 255 }).notNull(),
    category: varchar('category', { length: 255 }).notNull(),
    durationMs: int('duration_ms').notNull(),
    requestsOffered: int('requests_offered').notNull(),
    requestsSuccessful: int('requests_successful').notNull(),
    availabilityPercentage: double('availability_percentage').notNull(),
    p99Ms: double('p99_ms').notNull(),
    status: varchar('status', { length: 64, enum: ['PASSED', 'FAILED'] }).notNull(),
    detailsJson: text('details_json'),
  },
  (table) => [index('idx_campaign_scenarios_campaign').on(table.campaignId, table.scenarioNumber)],
);

export const campaignRunsRelations = relations(campaignRuns, ({ one, many }) => ({
  world: one(worlds, {
    fields: [campaignRuns.worldId],
    references: [worlds.id],
  }),
  scenarios: many(campaignScenarios),
}));

export const campaignScenariosRelations = relations(campaignScenarios, ({ one }) => ({
  campaign: one(campaignRuns, {
    fields: [campaignScenarios.campaignId],
    references: [campaignRuns.id],
  }),
}));
