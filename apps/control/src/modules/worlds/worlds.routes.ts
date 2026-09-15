import type { FastifyInstance } from 'fastify';
import { WorldsController } from './worlds.controller.js';

export async function worldsRoutes(fastify: FastifyInstance) {
  const controller = new WorldsController();

  fastify.get('/', controller.list.bind(controller));
  fastify.post('/', controller.create.bind(controller));
  fastify.get('/:id', controller.get.bind(controller));
  fastify.patch('/:id', controller.update.bind(controller));
  fastify.delete('/:id', controller.delete.bind(controller));
}
