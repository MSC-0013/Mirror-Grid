import type { FastifyInstance } from 'fastify';
import { ServicesController } from './services.controller.js';

export async function servicesRoutes(fastify: FastifyInstance) {
  const controller = new ServicesController();

  fastify.get('/', controller.list.bind(controller));
  fastify.post('/', controller.create.bind(controller));
  fastify.get('/:serviceId', controller.get.bind(controller));
  fastify.patch('/:serviceId', controller.update.bind(controller));
  fastify.delete('/:serviceId', controller.delete.bind(controller));
}
