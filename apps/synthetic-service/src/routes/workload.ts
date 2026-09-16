import type { FastifyInstance, FastifyRequest, FastifyReply } from 'fastify';
import { burnCpu } from '../engine/cpu-burner.js';
import { parseTraceParent, formatTraceParent, extractDeadline } from '../engine/context.js';
import { RpcClient } from '../engine/rpc-client.js';
import type { ServiceState, SyntheticRouteConfig } from './admin.js';

export function workloadHandler(state: ServiceState, rpcClient: RpcClient) {
  return async function handle(req: FastifyRequest, reply: FastifyReply) {
    const url = req.url.split('?')[0];

    // Find configured route or default fallback
    const route: SyntheticRouteConfig = state.routes.get(url) ?? {
      path: url,
      cpuBurnMs: 0,
      baseLatencyMs: 0,
      errorProbabilityPpm: 0,
      downstreamCalls: [],
    };

    // 1. Context parsing: W3C traceparent & deadline
    const traceCtx = parseTraceParent(req.headers['traceparent']);
    const deadlineCtx = extractDeadline(req.headers);

    // Set outbound traceparent header on reply
    reply.header('traceparent', formatTraceParent(traceCtx));

    // 2. Preemptive deadline check
    if (deadlineCtx) {
      const nowMicros = process.hrtime.bigint() / 1000n;
      if (deadlineCtx.isExpired(nowMicros)) {
        return reply.status(504).send({
          error: {
            code: 'DEADLINE_EXCEEDED',
            message: 'Request deadline exceeded before execution',
            traceId: traceCtx.traceId,
          },
        });
      }
    }

    // 3. Spontaneous internal error roll
    if (route.errorProbabilityPpm && route.errorProbabilityPpm > 0) {
      const roll = Math.floor(Math.random() * 1_000_000);
      if (roll < route.errorProbabilityPpm) {
        return reply.status(500).send({
          error: {
            code: 'SYNTHETIC_INTERNAL_ERROR',
            message: 'Injected internal error probability fired',
            traceId: traceCtx.traceId,
          },
        });
      }
    }

    // 4. CPU Burn
    if (route.cpuBurnMs && route.cpuBurnMs > 0) {
      await burnCpu(route.cpuBurnMs);
    }

    // 5. Base Latency delay
    if (route.baseLatencyMs && route.baseLatencyMs > 0) {
      await new Promise((resolve) => setTimeout(resolve, route.baseLatencyMs));
    }

    // 6. Downstream RPC Calls
    const downstreamResults: Record<string, unknown> = {};

    if (route.downstreamCalls && route.downstreamCalls.length > 0) {
      for (const call of route.downstreamCalls) {
        try {
          const res = await rpcClient.call(call, traceCtx, deadlineCtx);
          downstreamResults[call.serviceName] = res.body;
        } catch (err: unknown) {
          const statusCode = (err as { statusCode?: number }).statusCode ?? 500;
          return reply.status(statusCode).send({
            error: {
              code: 'DOWNSTREAM_FAILURE',
              message: `Failed downstream call to ${call.serviceName}: ${(err as Error).message}`,
              traceId: traceCtx.traceId,
              downstreamService: call.serviceName,
            },
          });
        }
      }
    }

    return reply.send({
      serviceId: state.serviceId,
      serviceName: state.serviceName,
      traceId: traceCtx.traceId,
      spanId: traceCtx.currentSpanId,
      status: 'OK',
      downstream: downstreamResults,
    });
  };
}

export async function workloadRoutes(
  fastify: FastifyInstance,
  opts: { state: ServiceState; rpcClient: RpcClient },
) {
  const handler = workloadHandler(opts.state, opts.rpcClient);

  // Catch all non-health and non-admin routes
  fastify.all('/*', async (req, reply) => {
    if (req.url.startsWith('/health') || req.url.startsWith('/admin')) {
      return;
    }
    return handler(req, reply);
  });
}
