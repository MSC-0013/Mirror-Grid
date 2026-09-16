import type { FastifyInstance } from 'fastify';
import { FaultController } from './fault.controller.js';

export async function faultsRoutes(fastify: FastifyInstance) {
  const controller = new FaultController();

  /* eslint-disable @typescript-eslint/no-explicit-any */
  fastify.post(
    '/',
    { preHandler: [fastify.requirePermission('faults:inject')] },
    async (req: any, reply) => controller.create(req, reply),
  );
  fastify.get(
    '/',
    { preHandler: [fastify.requirePermission('topology:read')] },
    async (req: any, reply) => controller.list(req, reply),
  );
  fastify.get(
    '/active',
    { preHandler: [fastify.requirePermission('topology:read')] },
    async (req: any, reply) => controller.listActive(req, reply),
  );
  fastify.get(
    '/:faultId',
    { preHandler: [fastify.requirePermission('topology:read')] },
    async (req: any, reply) => controller.get(req, reply),
  );
  fastify.post(
    '/:faultId/inject',
    { preHandler: [fastify.requirePermission('faults:inject')] },
    async (req: any, reply) => controller.inject(req, reply),
  );
  fastify.post(
    '/:executionId/disarm',
    { preHandler: [fastify.requirePermission('faults:inject')] },
    async (req: any, reply) => controller.disarm(req, reply),
  );
  /* eslint-enable @typescript-eslint/no-explicit-any */
}

export async function chaosRoutes(fastify: FastifyInstance) {
  const controller = new FaultController();
  /* eslint-disable @typescript-eslint/no-explicit-any */
  fastify.post(
    '/abort',
    { preHandler: [fastify.requirePermission('chaos:abort')] },
    async (req: any, reply) => controller.abort(req, reply),
  );
  /* eslint-enable @typescript-eslint/no-explicit-any */
}
