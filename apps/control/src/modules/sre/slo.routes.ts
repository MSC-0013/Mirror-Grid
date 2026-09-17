import type { FastifyInstance } from 'fastify';
import { eq, and } from 'drizzle-orm';
import { db, insertReturning, serviceSlos, sloBurnEvents, traceSpans } from '@mirrorgrid/db';
import {
  calculateErrorBudgetStatus,
  evaluateSli,
  type SloConfig,
  type RequestSample,
} from '@mirrorgrid/sre';
import { AppError } from '@mirrorgrid/platform';
import { z } from 'zod';

const createSloSchema = z.object({
  serviceId: z.string().min(1),
  name: z.string().min(1).max(120),
  sliType: z.enum(['AVAILABILITY', 'LATENCY_P99', 'LATENCY_P95']),
  targetPercentage: z.number().min(80.0).max(99.999),
  windowSeconds: z.number().int().positive().default(2592000),
  thresholdLatencyMicros: z.number().int().positive().optional(),
});

export async function sloRoutes(fastify: FastifyInstance) {
  // 1. Create Service SLO
  fastify.post(
    '/worlds/:worldId/slos',
    {
      preHandler: [fastify.requirePermission('topology:write')],
    },
    async (req, reply) => {
      const params = req.params as { worldId: string };
      const body = createSloSchema.parse(req.body);

      const slo = await insertReturning(serviceSlos, {
        worldId: params.worldId,
        serviceId: body.serviceId,
        name: body.name,
        sliType: body.sliType,
        targetPercentage: body.targetPercentage,
        windowSeconds: body.windowSeconds,
        thresholdLatencyMicros: body.thresholdLatencyMicros ?? null,
      });

      return reply.code(201).send(slo);
    },
  );

  // 2. List SLOs for World with Live Budget Status
  fastify.get(
    '/worlds/:worldId/slos',
    {
      preHandler: [fastify.requirePermission('topology:read')],
    },
    async (req) => {
      const params = req.params as { worldId: string };

      const slos = await db
        .select()
        .from(serviceSlos)
        .where(eq(serviceSlos.worldId, params.worldId));

      const results = await Promise.all(
        slos.map(async (slo) => {
          // Fetch recent spans for this service to calculate live SLI
          const spans = await db
            .select({
              statusCode: traceSpans.statusCode,
              durationMicros: traceSpans.durationMicros,
            })
            .from(traceSpans)
            .where(
              and(
                eq(traceSpans.worldId, params.worldId),
                eq(traceSpans.serviceId, slo.serviceId),
              ),
            )
            .limit(500);

          const samples: RequestSample[] = spans.map((s) => ({
            isError: s.statusCode === 'ERROR',
            durationMicros: s.durationMicros,
          }));

          const config: SloConfig = {
            id: slo.id,
            worldId: slo.worldId,
            serviceId: slo.serviceId,
            name: slo.name,
            type: slo.sliType as SloConfig['type'],
            targetPercentage: slo.targetPercentage,
            windowSeconds: slo.windowSeconds,
            thresholdLatencyMicros: slo.thresholdLatencyMicros ?? undefined,
          };

          const sliResult = evaluateSli(config, samples);
          const budget = calculateErrorBudgetStatus({
            sloId: slo.id,
            targetPercentage: slo.targetPercentage,
            currentPercentage: sliResult.currentPercentage,
            windowSeconds: slo.windowSeconds,
            totalRequests: sliResult.totalRequests,
            badRequests: sliResult.badRequests,
          });

          return {
            ...slo,
            budget,
          };
        }),
      );

      return { data: results };
    },
  );

  // 3. Get Single SLO Live Budget Status
  fastify.get(
    '/worlds/:worldId/slos/:sloId/budget',
    {
      preHandler: [fastify.requirePermission('topology:read')],
    },
    async (req) => {
      const params = req.params as { worldId: string; sloId: string };

      const [slo] = await db
        .select()
        .from(serviceSlos)
        .where(
          and(
            eq(serviceSlos.id, params.sloId),
            eq(serviceSlos.worldId, params.worldId),
          ),
        )
        .limit(1);

      if (!slo) {
        throw AppError.notFound('SLO', params.sloId);
      }

      const spans = await db
        .select({
          statusCode: traceSpans.statusCode,
          durationMicros: traceSpans.durationMicros,
        })
        .from(traceSpans)
        .where(
          and(
            eq(traceSpans.worldId, params.worldId),
            eq(traceSpans.serviceId, slo.serviceId),
          ),
        )
        .limit(1000);

      const samples: RequestSample[] = spans.map((s) => ({
        isError: s.statusCode === 'ERROR',
        durationMicros: s.durationMicros,
      }));

      const config: SloConfig = {
        id: slo.id,
        worldId: slo.worldId,
        serviceId: slo.serviceId,
        name: slo.name,
        type: slo.sliType as SloConfig['type'],
        targetPercentage: slo.targetPercentage,
        windowSeconds: slo.windowSeconds,
        thresholdLatencyMicros: slo.thresholdLatencyMicros ?? undefined,
      };

      const sliResult = evaluateSli(config, samples);
      const budget = calculateErrorBudgetStatus({
        sloId: slo.id,
        targetPercentage: slo.targetPercentage,
        currentPercentage: sliResult.currentPercentage,
        windowSeconds: slo.windowSeconds,
        totalRequests: sliResult.totalRequests,
        badRequests: sliResult.badRequests,
      });

      return budget;
    },
  );

  // 4. Record SLO Burn Event
  fastify.post(
    '/worlds/:worldId/slos/:sloId/burn-events',
    {
      preHandler: [fastify.requirePermission('topology:write')],
    },
    async (req, reply) => {
      const params = req.params as { worldId: string; sloId: string };
      const body = req.body as {
        burnRate: number;
        severity: 'P1_CRITICAL' | 'P2_HIGH' | 'P3_WARNING';
        longWindowSeconds: number;
        shortWindowSeconds: number;
        budgetConsumedPercent: number;
      };

      const event = await insertReturning(sloBurnEvents, {
        sloId: params.sloId,
        burnRate: body.burnRate,
        severity: body.severity,
        longWindowSeconds: body.longWindowSeconds,
        shortWindowSeconds: body.shortWindowSeconds,
        budgetConsumedPercent: body.budgetConsumedPercent,
      });

      return reply.code(201).send(event);
    },
  );
}
