import type { FastifyInstance } from 'fastify';
import { randomUUID } from 'node:crypto';

export async function requestIdPlugin(fastify: FastifyInstance) {
  fastify.addHook('onRequest', async (req, reply) => {
    const existingId = req.headers['x-request-id'];
    const requestId =
      typeof existingId === 'string' && existingId.trim() ? existingId : randomUUID();

    // Store on request and response headers
    req.headers['x-request-id'] = requestId;
    reply.header('x-request-id', requestId);
  });
}
