import type { FastifyInstance } from 'fastify';

export interface HealthOptions {
  serviceId: string;
  serviceName: string;
  isReady?: () => boolean;
}

export async function healthRoutes(fastify: FastifyInstance, opts: HealthOptions) {
  fastify.get('/health/live', async () => {
    return { status: 'ok' };
  });

  fastify.get('/health/ready', async (_req, reply) => {
    const ready = opts.isReady ? opts.isReady() : true;
    if (!ready) {
      return reply.status(503).send({ status: 'not_ready' });
    }
    return {
      status: 'ready',
      serviceId: opts.serviceId,
      serviceName: opts.serviceName,
    };
  });
}
