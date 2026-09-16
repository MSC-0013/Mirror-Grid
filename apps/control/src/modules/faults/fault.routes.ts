import type { FastifyInstance } from 'fastify';
import { FaultController } from './fault.controller.js';

export async function faultsRoutes(fastify: FastifyInstance) {
  const controller = new FaultController();

  fastify.post('/', controller.create.bind(controller));
  fastify.get('/', controller.list.bind(controller));
  fastify.get('/active', controller.listActive.bind(controller));
  fastify.get('/:faultId', controller.get.bind(controller));
  fastify.post('/:faultId/inject', controller.inject.bind(controller));
  fastify.post('/:executionId/disarm', controller.disarm.bind(controller));
}

export async function chaosRoutes(fastify: FastifyInstance) {
  const controller = new FaultController();
  fastify.post('/abort', controller.abort.bind(controller));
}
