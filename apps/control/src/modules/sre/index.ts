import type { FastifyInstance } from 'fastify';
import { sloRoutes } from './slo.routes.js';
import { rcaRoutes } from './rca.routes.js';

export async function sreRoutes(fastify: FastifyInstance) {
  await fastify.register(sloRoutes, { prefix: '/api/v1' });
  await fastify.register(rcaRoutes, { prefix: '/api/v1' });
}

export * from './slo.routes.js';
export * from './rca.routes.js';
