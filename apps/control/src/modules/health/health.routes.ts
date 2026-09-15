import type { FastifyInstance } from 'fastify';
import { HealthAggregator } from '@mirrorgrid/platform';
import { DbHealthProbe } from '@mirrorgrid/db';

export async function healthRoutes(fastify: FastifyInstance) {
  const aggregator = new HealthAggregator();
  aggregator.register(new DbHealthProbe());

  // Liveness probe: Is the Node.js process alive?
  fastify.get('/live', async (_req, reply) => {
    return reply.status(200).send({ status: 'ok' });
  });

  // Readiness probe: Are critical dependencies available?
  fastify.get('/ready', async (_req, reply) => {
    const { ready, dependencies } = await aggregator.isReady();
    if (!ready) {
      return reply.status(503).send({
        status: 'not_ready',
        dependencies,
      });
    }
    return reply.status(200).send({ status: 'ok' });
  });

  // Status probe: Comprehensive component health report (never 5xx)
  fastify.get('/status', async (_req, reply) => {
    const report = await aggregator.getFullReport();
    return reply.status(200).send(report);
  });
}
