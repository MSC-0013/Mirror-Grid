import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { jobsService } from './jobs.service.js';

const enqueueSchema = z.object({
  jobType: z.string().min(1),
  payload: z.record(z.string(), z.unknown()).default({}),
  queueName: z.string().optional(),
  priority: z.number().int().optional(),
  maxAttempts: z.number().int().positive().optional(),
  delayMs: z.number().int().nonnegative().optional(),
});

export async function jobsRoutes(fastify: FastifyInstance) {
  fastify.get(
    '/queues',
    {
      preHandler: [fastify.requirePermission('topology:read')],
    },
    async () => {
      return jobsService.getQueueStats();
    },
  );

  fastify.get(
    '/dlq',
    {
      preHandler: [fastify.requirePermission('topology:read')],
    },
    async (req) => {
      const query = req.query as { queueName?: string; page?: string; limit?: string };
      return jobsService.listDeadLetters({
        queueName: query.queueName,
        page: query.page ? parseInt(query.page, 10) : undefined,
        limit: query.limit ? parseInt(query.limit, 10) : undefined,
      });
    },
  );

  fastify.post(
    '/dlq/:id/redrive',
    {
      preHandler: [fastify.requirePermission('topology:write')],
    },
    async (req) => {
      const params = req.params as { id: string };
      return jobsService.redrive(params.id, req.principal ?? undefined);
    },
  );

  fastify.post(
    '/',
    {
      preHandler: [fastify.requirePermission('topology:write')],
    },
    async (req, reply) => {
      const body = enqueueSchema.parse(req.body);
      const job = await jobsService.enqueue(
        body.jobType,
        body.payload,
        {
          queueName: body.queueName,
          priority: body.priority,
          maxAttempts: body.maxAttempts,
          delayMs: body.delayMs,
        },
        req.principal ?? undefined,
      );
      return reply.status(201).send({ data: job });
    },
  );
}
