import type { FastifyInstance } from 'fastify';
import { eq, and, desc, gte, lte } from 'drizzle-orm';
import {
  db,
  insertReturning,
  services,
  serviceDependencies,
  traceSpans,
  rcaInvestigations,
  reliabilityReports,
  serviceSlos,
} from '@mirrorgrid/db';
import {
  RcaEngine,
  ExecutiveReportCompiler,
  calculateErrorBudgetStatus,
  evaluateSli,
  type GraphNode,
  type GraphEdge,
  type NodeMetrics,
  type RcaInvestigationResult,
  type CausalChainNode,
  type ErrorBudgetStatus,
  type SloConfig,
  type RequestSample,
} from '@mirrorgrid/sre';
import { AppError } from '@mirrorgrid/platform';
import { z } from 'zod';

const analyzeRcaSchema = z.object({
  fromMicros: z.number().int().positive().optional(),
  toMicros: z.number().int().positive().optional(),
  experimentRunId: z.string().optional(),
  overrideMetrics: z
    .array(
      z.object({
        serviceId: z.string(),
        serviceName: z.string(),
        isDegraded: z.boolean(),
        firstAnomalyTimestampMicros: z.number(),
        totalLatencyMicros: z.number(),
        selfLatencyMicros: z.number(),
        errorCount: z.number(),
        requestCount: z.number(),
        metricType: z.string(),
        deviationFactor: z.number(),
      }),
    )
    .optional(),
});

const generateReportSchema = z.object({
  title: z.string().min(1).max(255),
  timeRangeStart: z.union([z.string(), z.number()]),
  timeRangeEnd: z.union([z.string(), z.number()]),
  experimentRunId: z.string().optional(),
});

export async function rcaRoutes(fastify: FastifyInstance) {
  // 1. Trigger Automated RCA Analysis
  fastify.post(
    '/worlds/:worldId/rca/analyze',
    {
      preHandler: [fastify.requirePermission('experiments:run')],
    },
    async (req, reply) => {
      const params = req.params as { worldId: string };
      const body = analyzeRcaSchema.parse(req.body ?? {});

      // 1. Fetch Topology Nodes (Services)
      const serviceRows = await db
        .select({ id: services.id, name: services.name })
        .from(services)
        .where(eq(services.worldId, params.worldId));

      const nodes: GraphNode[] = serviceRows.map((s) => ({
        id: s.id,
        name: s.name,
      }));

      // 2. Fetch Topology Edges (Dependencies)
      const depRows = await db
        .select({
          sourceId: serviceDependencies.sourceServiceId,
          targetId: serviceDependencies.targetServiceId,
        })
        .from(serviceDependencies)
        .where(eq(serviceDependencies.worldId, params.worldId));

      const edges: GraphEdge[] = depRows.map((d) => ({
        sourceId: d.sourceId,
        targetId: d.targetId,
      }));

      let metrics: NodeMetrics[] = [];

      if (body.overrideMetrics && body.overrideMetrics.length > 0) {
        metrics = body.overrideMetrics;
      } else {
        // Derive metrics from trace_spans
        const spanConditions = [eq(traceSpans.worldId, params.worldId)];
        if (body.fromMicros) spanConditions.push(gte(traceSpans.startTimeMicros, body.fromMicros));
        if (body.toMicros) spanConditions.push(lte(traceSpans.startTimeMicros, body.toMicros));

        const spans = await db
          .select({
            serviceId: traceSpans.serviceId,
            serviceName: traceSpans.serviceName,
            statusCode: traceSpans.statusCode,
            durationMicros: traceSpans.durationMicros,
            startTimeMicros: traceSpans.startTimeMicros,
          })
          .from(traceSpans)
          .where(and(...spanConditions))
          .limit(2000);

        // Group spans by service
        const serviceSpans = new Map<string, typeof spans>();
        for (const span of spans) {
          const key = span.serviceId ?? span.serviceName;
          const list = serviceSpans.get(key) ?? [];
          list.push(span);
          serviceSpans.set(key, list);
        }

        metrics = nodes.map((node) => {
          const sList = serviceSpans.get(node.id) ?? [];
          const reqCount = sList.length;
          const errors = sList.filter((s) => s.statusCode === 'ERROR');
          const errCount = errors.length;
          const totalLat = reqCount > 0 ? sList.reduce((a, b) => a + b.durationMicros, 0) / reqCount : 0;
          const isDegraded = errCount > 0 || totalLat > 100_000;
          const firstAnomaly = errors[0]?.startTimeMicros ?? (isDegraded ? sList[0]?.startTimeMicros ?? 0 : 0);

          return {
            serviceId: node.id,
            serviceName: node.name,
            isDegraded,
            firstAnomalyTimestampMicros: firstAnomaly,
            totalLatencyMicros: Math.round(totalLat),
            selfLatencyMicros: Math.round(totalLat * 0.9),
            errorCount: errCount,
            requestCount: reqCount,
            metricType: errCount > 0 ? 'STATUS_ERROR_CASCADE' : isDegraded ? 'LATENCY_DEGRADATION' : 'NORMAL',
            deviationFactor: isDegraded ? 3.5 : 1.0,
          };
        });
      }

      // Run graph-theoretic RCA
      const rcaResult: RcaInvestigationResult = RcaEngine.analyze({ nodes, edges, metrics });

      // Save investigation
      const investigation = await insertReturning(rcaInvestigations, {
        worldId: params.worldId,
        experimentRunId: body.experimentRunId ?? null,
        rootCauseServiceId: rcaResult.rootCauseServiceId || null,
        confidencePercentage: rcaResult.confidencePercentage,
        failureType: rcaResult.failureType,
        causalChain: [...rcaResult.causalPath],
        evidenceSummary: {
          explanation: rcaResult.explanation,
          recommendation: rcaResult.architecturalRecommendation,
        },
      });

      return reply.code(200).send({
        investigationId: investigation?.id,
        ...rcaResult,
      });
    },
  );

  // 2. List RCA Investigations
  fastify.get(
    '/worlds/:worldId/rca/investigations',
    {
      preHandler: [fastify.requirePermission('experiments:read')],
    },
    async (req) => {
      const params = req.params as { worldId: string };
      const investigations = await db
        .select()
        .from(rcaInvestigations)
        .where(eq(rcaInvestigations.worldId, params.worldId))
        .orderBy(desc(rcaInvestigations.createdAt))
        .limit(20);

      return { data: investigations };
    },
  );

  // 3. Generate Executive Reliability Report
  fastify.post(
    '/worlds/:worldId/reports/generate',
    {
      preHandler: [fastify.requirePermission('experiments:run')],
    },
    async (req, reply) => {
      const params = req.params as { worldId: string };
      const body = generateReportSchema.parse(req.body);

      const start = typeof body.timeRangeStart === 'number' ? new Date(body.timeRangeStart) : new Date(body.timeRangeStart);
      const end = typeof body.timeRangeEnd === 'number' ? new Date(body.timeRangeEnd) : new Date(body.timeRangeEnd);

      // 1. Fetch latest or run RCA for this world
      const [latestRca] = await db
        .select()
        .from(rcaInvestigations)
        .where(eq(rcaInvestigations.worldId, params.worldId))
        .orderBy(desc(rcaInvestigations.createdAt))
        .limit(1);

      let rcaResult: RcaInvestigationResult;
      if (latestRca) {
        rcaResult = {
          rootCauseServiceId: latestRca.rootCauseServiceId ?? '',
          rootCauseServiceName: latestRca.rootCauseServiceId ?? 'Payments',
          confidencePercentage: latestRca.confidencePercentage,
          failureType: latestRca.failureType,
          causalPath: (latestRca.causalChain as unknown as CausalChainNode[]) ?? [],
          explanation: (latestRca.evidenceSummary?.['explanation'] as string) ?? 'RCA investigation record',
          architecturalRecommendation: (latestRca.evidenceSummary?.['recommendation'] as string) ?? 'Install circuit breakers.',
        };
      } else {
        rcaResult = {
          rootCauseServiceId: '',
          rootCauseServiceName: 'None',
          confidencePercentage: 100.0,
          failureType: 'RESOURCE_STARVATION',
          causalPath: [],
          explanation: 'All services healthy during evaluation window.',
          architecturalRecommendation: 'Maintain standard monitoring.',
        };
      }

      // 2. Fetch SLO Budgets
      const slos = await db
        .select()
        .from(serviceSlos)
        .where(eq(serviceSlos.worldId, params.worldId));

      const budgets: ErrorBudgetStatus[] = await Promise.all(
        slos.map(async (slo) => {
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
          return calculateErrorBudgetStatus({
            sloId: slo.id,
            targetPercentage: slo.targetPercentage,
            currentPercentage: sliResult.currentPercentage,
            windowSeconds: slo.windowSeconds,
            totalRequests: sliResult.totalRequests,
            badRequests: sliResult.badRequests,
          });
        }),
      );

      // Compile report
      const compiled = ExecutiveReportCompiler.compile({
        title: body.title,
        timeRangeStart: start,
        timeRangeEnd: end,
        rca: rcaResult,
        budgets,
      });

      // Save to database
      const saved = await insertReturning(reliabilityReports, {
        worldId: params.worldId,
        title: compiled.title,
        timeRangeStart: compiled.timeRangeStart,
        timeRangeEnd: compiled.timeRangeEnd,
        overallScore: compiled.overallScore,
        errorBudgetConsumedPercent: compiled.errorBudgetConsumedPercent,
        reportMarkdown: compiled.markdown,
      });

      return reply.code(201).send({
        reportId: saved?.id,
        reportMarkdown: compiled.markdown,
        ...compiled,
      });
    },
  );

  // 4. List Generated Reports
  fastify.get(
    '/worlds/:worldId/reports',
    {
      preHandler: [fastify.requirePermission('experiments:read')],
    },
    async (req) => {
      const params = req.params as { worldId: string };
      const reports = await db
        .select()
        .from(reliabilityReports)
        .where(eq(reliabilityReports.worldId, params.worldId))
        .orderBy(desc(reliabilityReports.createdAt));

      return { data: reports };
    },
  );

  // 5. Get Single Report
  fastify.get(
    '/worlds/:worldId/reports/:reportId',
    {
      preHandler: [fastify.requirePermission('experiments:read')],
    },
    async (req) => {
      const params = req.params as { worldId: string; reportId: string };
      const [report] = await db
        .select()
        .from(reliabilityReports)
        .where(
          and(
            eq(reliabilityReports.id, params.reportId),
            eq(reliabilityReports.worldId, params.worldId),
          ),
        )
        .limit(1);

      if (!report) {
        throw AppError.notFound('Report', params.reportId);
      }

      return report;
    },
  );
}
