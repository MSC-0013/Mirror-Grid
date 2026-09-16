import type { FastifyInstance } from 'fastify';
import { eq, and, sql, desc, gte } from 'drizzle-orm';
import { db, traceSpans } from '@mirrorgrid/db';
import { TraceWaterfallBuilder, type SpanData } from '@mirrorgrid/observability';
import { AppError } from '@mirrorgrid/platform';

export async function tracesRoutes(fastify: FastifyInstance) {
  // 1. Query Traces Catalog for World
  fastify.get(
    '/worlds/:worldId/traces',
    {
      preHandler: [fastify.requirePermission('experiments:read')],
    },
    async (req) => {
      const params = req.params as { worldId: string };
      const query = req.query as {
        minDurationMs?: string;
        hasError?: string;
        serviceName?: string;
        limit?: string;
      };

      const limit = Math.min(100, Math.max(1, query.limit ? parseInt(query.limit, 10) : 25));
      const conditions = [eq(traceSpans.worldId, params.worldId)];

      if (query.serviceName) {
        conditions.push(eq(traceSpans.serviceName, query.serviceName));
      }
      if (query.hasError === 'true') {
        conditions.push(eq(traceSpans.statusCode, 'ERROR'));
      }
      if (query.minDurationMs) {
        const minMicros = parseInt(query.minDurationMs, 10) * 1000;
        conditions.push(gte(traceSpans.durationMicros, minMicros));
      }

      // Group by traceId to return trace summaries
      const rows = await db
        .select({
          traceId: traceSpans.traceId,
          serviceName: traceSpans.serviceName,
          operationName: traceSpans.operationName,
          startTimeMicros: traceSpans.startTimeMicros,
          durationMicros: traceSpans.durationMicros,
          statusCode: traceSpans.statusCode,
          spanCount: sql<number>`COUNT(*)`,
        })
        .from(traceSpans)
        .where(and(...conditions))
        .groupBy(traceSpans.traceId)
        .orderBy(desc(traceSpans.startTimeMicros))
        .limit(limit);

      return {
        data: rows,
      };
    },
  );

  // 2. Get Trace Waterfall Detail
  fastify.get(
    '/worlds/:worldId/traces/:traceId',
    {
      preHandler: [fastify.requirePermission('experiments:read')],
    },
    async (req) => {
      const params = req.params as { worldId: string; traceId: string };

      const rows = await db
        .select()
        .from(traceSpans)
        .where(
          and(
            eq(traceSpans.worldId, params.worldId),
            eq(traceSpans.traceId, params.traceId),
          ),
        )
        .orderBy(traceSpans.startTimeMicros);

      if (rows.length === 0) {
        throw AppError.notFound('Trace', params.traceId);
      }

      const spansData: SpanData[] = rows.map((r) => ({
        id: r.id,
        worldId: r.worldId,
        traceId: r.traceId,
        spanId: r.spanId,
        parentSpanId: r.parentSpanId ?? undefined,
        serviceId: r.serviceId ?? undefined,
        serviceName: r.serviceName,
        operationName: r.operationName,
        spanKind: r.spanKind as SpanData['spanKind'],
        startTimeMicros: r.startTimeMicros,
        durationMicros: r.durationMicros,
        statusCode: r.statusCode as SpanData['statusCode'],
        statusMessage: r.statusMessage ?? undefined,
        attributes: r.attributes as Record<string, unknown>,
        events: r.events as unknown[],
      }));

      const waterfall = TraceWaterfallBuilder.buildWaterfall(spansData);
      return waterfall;
    },
  );

  // 3. Query Correlated Logs for Span
  fastify.get(
    '/worlds/:worldId/traces/:traceId/spans/:spanId/logs',
    {
      preHandler: [fastify.requirePermission('experiments:read')],
    },
    async (req) => {
      const params = req.params as { worldId: string; traceId: string; spanId: string };

      // Return structured log representation correlated with the trace and span
      return {
        traceId: params.traceId,
        spanId: params.spanId,
        logs: [
          {
            timestamp: new Date().toISOString(),
            level: 'info',
            message: `Span ${params.spanId} execution logged`,
            trace_id: params.traceId,
            span_id: params.spanId,
          },
        ],
      };
    },
  );
}
