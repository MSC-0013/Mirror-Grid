import type { FastifyInstance } from 'fastify';
import { MetricRegistry } from '@mirrorgrid/observability';

export async function metricsRoutes(fastify: FastifyInstance) {
  fastify.get('/metrics', async (_req, reply) => {
    const text = MetricRegistry.getInstance().exportPrometheus();
    return reply
      .header('Content-Type', 'text/plain; version=0.0.4; charset=utf-8')
      .send(text);
  });
}
