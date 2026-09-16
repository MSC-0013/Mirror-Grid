import type { FastifyInstance } from 'fastify';
import { BreakerController } from './breaker.controller.js';

export async function breakersRoutes(fastify: FastifyInstance) {
  const controller = new BreakerController();

  fastify.get('/', controller.list.bind(controller));
  fastify.get('/transitions', controller.listTransitions.bind(controller));
  fastify.post('/:breakerId/trip', controller.trip.bind(controller));
  fastify.post('/:breakerId/reset', controller.reset.bind(controller));
}
