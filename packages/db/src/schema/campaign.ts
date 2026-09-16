import { sqliteTable, text, integer, real, index } from 'drizzle-orm/sqlite-core';
import { relations } from 'drizzle-orm';
import { worlds } from './core.js';

export const campaignRuns = sqliteTable(
  'campaign_runs',
  {
    id: text('id')
      .primaryKey()
      .$defaultFn(() => crypto.randomUUID()),
    worldId: text('world_id')
      .notNull()
      .references(() => worlds.id, { onDelete: 'cascade' }),
    totalScenarios: integer('total_scenarios').notNull().default(20),
    passedScenarios: integer('passed_scenarios').notNull().default(0),
    failedScenarios: integer('failed_scenarios').notNull().default(0),
    totalThroughputRps: real('total_throughput_rps').notNull().default(0.0),
    p99LatencyMs: real('p99_latency_ms').notNull().default(0.0),
    heapDeltaBytes: integer('heap_delta_bytes').notNull().default(0),
    status: text('status', {
      enum: ['RUNNING', 'COMPLETED', 'FAILED'],
    })
      .notNull()
      .default('RUNNING'),
    startedAt: integer('started_at', { mode: 'timestamp_ms' })
      .notNull()
      .$defaultFn(() => new Date()),
    completedAt: integer('completed_at', { mode: 'timestamp_ms' }),
  },
  (table) => [index('idx_campaign_runs_world').on(table.worldId, table.status)],
);

export const campaignScenarios = sqliteTable(
  'campaign_scenarios',
  {
    id: text('id')
      .primaryKey()
      .$defaultFn(() => crypto.randomUUID()),
    campaignId: text('campaign_id')
      .notNull()
      .references(() => campaignRuns.id, { onDelete: 'cascade' }),
    scenarioNumber: integer('scenario_number').notNull(),
    name: text('name').notNull(),
    category: text('category').notNull(),
    durationMs: integer('duration_ms').notNull(),
    requestsOffered: integer('requests_offered').notNull(),
    requestsSuccessful: integer('requests_successful').notNull(),
    availabilityPercentage: real('availability_percentage').notNull(),
    p99Ms: real('p99_ms').notNull(),
    status: text('status', {
      enum: ['PASSED', 'FAILED'],
    }).notNull(),
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
