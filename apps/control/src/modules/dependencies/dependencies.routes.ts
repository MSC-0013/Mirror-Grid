import type { FastifyInstance } from 'fastify';
import { DependenciesController } from './dependencies.controller.js';

export async function dependenciesRoutes(fastify: FastifyInstance) {
  const controller = new DependenciesController();

  fastify.get('/', controller.list.bind(controller));
  fastify.post('/', controller.create.bind(controller));
  fastify.get('/:id', controller.get.bind(controller));
  fastify.patch('/:id', controller.update.bind(controller));
  fastify.delete('/:id', controller.delete.bind(controller));
}
