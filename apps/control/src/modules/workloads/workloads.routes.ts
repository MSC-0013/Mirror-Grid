import type { FastifyInstance } from 'fastify';
import { WorkloadsController } from './workloads.controller.js';

export async function workloadsRoutes(fastify: FastifyInstance) {
  const controller = new WorkloadsController();

  fastify.get('/', controller.list.bind(controller));
  fastify.post('/', controller.create.bind(controller));
  fastify.patch('/:id', controller.update.bind(controller));
  fastify.delete('/:id', controller.delete.bind(controller));
}
