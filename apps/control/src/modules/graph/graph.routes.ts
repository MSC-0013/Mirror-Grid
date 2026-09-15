import type { FastifyInstance } from 'fastify';
import { GraphController } from './graph.controller.js';

export async function graphRoutes(fastify: FastifyInstance) {
  const controller = new GraphController();

  fastify.get('/', controller.getGraph.bind(controller));
}
