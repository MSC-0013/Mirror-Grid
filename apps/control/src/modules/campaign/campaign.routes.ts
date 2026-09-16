import type { FastifyInstance } from 'fastify';
import { eq, and, desc } from 'drizzle-orm';
import { db, worlds, campaignRuns, campaignScenarios } from '@mirrorgrid/db';
import {
  CampaignExecutor,
  CampaignReportGenerator,
  type CampaignResult,
  type ScenarioCategory,
} from '@mirrorgrid/experiments';
import { AppError } from '@mirrorgrid/platform';

export async function campaignRoutes(fastify: FastifyInstance) {
  // 1. Launch 20-Scenario Automated Chaos Campaign
  fastify.post(
    '/worlds/:worldId/campaign/run',
    {
      preHandler: [fastify.requirePermission('experiments:run')],
    },
    async (req, reply) => {
      const params = req.params as { worldId: string };

      const world = await db.query.worlds.findFirst({
        where: eq(worlds.id, params.worldId),
      });

      if (!world) {
        throw AppError.notFound(`World ${params.worldId} not found`);
      }

      // Execute 20 scenarios
      const result = await CampaignExecutor.run20Scenarios({ worldId: params.worldId });

      // Persist Campaign Run
      await db.insert(campaignRuns).values({
        id: result.campaignId,
        worldId: params.worldId,
        totalScenarios: result.totalScenarios,
        passedScenarios: result.passedScenarios,
        failedScenarios: result.failedScenarios,
        totalThroughputRps: result.totalThroughputRps,
        p99LatencyMs: result.p99LatencyMs,
        heapDeltaBytes: result.heapDeltaBytes,
        status: result.status,
        startedAt: new Date(),
        completedAt: new Date(),
      });

      // Persist all 20 scenario rows
      const scenarioInserts = result.scenarios.map((s) => ({
        id: crypto.randomUUID(),
        campaignId: result.campaignId,
        scenarioNumber: s.scenarioNumber,
        name: s.name,
        category: s.category,
        durationMs: s.durationMs,
        requestsOffered: s.requestsOffered,
        requestsSuccessful: s.requestsSuccessful,
        availabilityPercentage: s.availabilityPercentage,
        p99Ms: s.p99Ms,
        status: s.status,
        detailsJson: JSON.stringify(s.details),
      }));

      await db.insert(campaignScenarios).values(scenarioInserts);

      return reply.status(201).send({
        success: true,
        data: result,
      });
    },
  );

  // 2. Get Latest Campaign Run
  fastify.get(
    '/worlds/:worldId/campaign/latest',
    {
      preHandler: [fastify.requirePermission('experiments:read')],
    },
    async (req, reply) => {
      const params = req.params as { worldId: string };

      const latestRun = await db.query.campaignRuns.findFirst({
        where: eq(campaignRuns.worldId, params.worldId),
        orderBy: [desc(campaignRuns.startedAt)],
      });

      if (!latestRun) {
        throw AppError.notFound(`No campaign runs found for world ${params.worldId}`);
      }

      const scenarios = await db.query.campaignScenarios.findMany({
        where: eq(campaignScenarios.campaignId, latestRun.id),
      });

      return reply.send({
        success: true,
        data: {
          campaign: latestRun,
          scenarios,
        },
      });
    },
  );

  // 3. Get Campaign Run by ID
  fastify.get(
    '/worlds/:worldId/campaign/:campaignId',
    {
      preHandler: [fastify.requirePermission('experiments:read')],
    },
    async (req, reply) => {
      const params = req.params as { worldId: string; campaignId: string };

      const run = await db.query.campaignRuns.findFirst({
        where: and(
          eq(campaignRuns.id, params.campaignId),
          eq(campaignRuns.worldId, params.worldId),
        ),
      });

      if (!run) {
        throw AppError.notFound(`Campaign run ${params.campaignId} not found`);
      }

      const scenarios = await db.query.campaignScenarios.findMany({
        where: eq(campaignScenarios.campaignId, run.id),
      });

      return reply.send({
        success: true,
        data: {
          campaign: run,
          scenarios,
        },
      });
    },
  );

  // 4. Generate Executive Markdown Certification Report
  fastify.get(
    '/worlds/:worldId/campaign/:campaignId/report',
    {
      preHandler: [fastify.requirePermission('experiments:read')],
    },
    async (req, reply) => {
      const params = req.params as { worldId: string; campaignId: string };

      const run = await db.query.campaignRuns.findFirst({
        where: and(
          eq(campaignRuns.id, params.campaignId),
          eq(campaignRuns.worldId, params.worldId),
        ),
      });

      if (!run) {
        throw AppError.notFound(`Campaign run ${params.campaignId} not found`);
      }

      const dbScenarios = await db.query.campaignScenarios.findMany({
        where: eq(campaignScenarios.campaignId, run.id),
      });

      const campaignResult: CampaignResult = {
        campaignId: run.id,
        worldId: run.worldId,
        totalScenarios: run.totalScenarios,
        passedScenarios: run.passedScenarios,
        failedScenarios: run.failedScenarios,
        totalThroughputRps: run.totalThroughputRps,
        p99LatencyMs: run.p99LatencyMs,
        heapDeltaBytes: run.heapDeltaBytes,
        status: run.status as 'COMPLETED' | 'FAILED',
        scenarios: dbScenarios.map((s) => ({
          scenarioNumber: s.scenarioNumber,
          name: s.name,
          category: s.category as ScenarioCategory,
          durationMs: s.durationMs,
          requestsOffered: s.requestsOffered,
          requestsSuccessful: s.requestsSuccessful,
          availabilityPercentage: s.availabilityPercentage,
          p99Ms: s.p99Ms,
          status: s.status as 'PASSED' | 'FAILED',
          details: s.detailsJson ? JSON.parse(s.detailsJson) : {},
        })),
      };

      const markdown = CampaignReportGenerator.generateMarkdown(campaignResult);

      return reply.send({
        success: true,
        data: {
          campaignId: run.id,
          reportMarkdown: markdown,
          certified: run.passedScenarios === 20 && run.failedScenarios === 0,
        },
      });
    },
  );
}
