import type { FastifyInstance } from 'fastify';
import { RuntimeController } from './runtime.controller.js';

export async function runtimeRoutes(fastify: FastifyInstance) {
  const controller = new RuntimeController();

  fastify.post('/deploy', controller.deploy.bind(controller));
  fastify.get('/fleet', controller.fleet.bind(controller));
  fastify.post('/containers/:containerId/restart', controller.restart.bind(controller));
  fastify.get('/containers/:containerId/logs', controller.logs.bind(controller));
}
