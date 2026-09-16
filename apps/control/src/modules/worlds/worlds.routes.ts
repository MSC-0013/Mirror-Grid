import type { FastifyInstance } from 'fastify';
import { WorldsController } from './worlds.controller.js';

export async function worldsRoutes(fastify: FastifyInstance) {
  const controller = new WorldsController();

  fastify.get(
    '/',
    { preHandler: [fastify.requirePermission('topology:read')] },
    controller.list.bind(controller),
  );
  fastify.post(
    '/',
    { preHandler: [fastify.requirePermission('topology:write')] },
    controller.create.bind(controller),
  );
  fastify.get(
    '/:id',
    { preHandler: [fastify.requirePermission('topology:read')] },
    controller.get.bind(controller),
  );
  fastify.patch(
    '/:id',
    { preHandler: [fastify.requirePermission('topology:write')] },
    controller.update.bind(controller),
  );
  fastify.delete(
    '/:id',
    { preHandler: [fastify.requirePermission('topology:write')] },
    controller.delete.bind(controller),
  );
}
