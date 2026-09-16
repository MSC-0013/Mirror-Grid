import type { FastifyInstance } from 'fastify';
import { auditService } from './audit.service.js';

export async function auditRoutes(fastify: FastifyInstance) {
  fastify.get(
    '/',
    {
      preHandler: [fastify.requirePermission('audit:read')],
    },
    async (req) => {
      const query = req.query as {
        page?: string;
        limit?: string;
        resourceType?: string;
        action?: string;
        userId?: string;
      };

      return auditService.list({
        page: query.page ? parseInt(query.page, 10) : undefined,
        limit: query.limit ? parseInt(query.limit, 10) : undefined,
        resourceType: query.resourceType,
        action: query.action,
        userId: query.userId,
      });
    },
  );

  fastify.post(
    '/verify',
    {
      preHandler: [fastify.requirePermission('audit:read')],
    },
    async (req) => {
      const body = (req.body as { fromSeq?: number; toSeq?: number }) ?? {};
      return auditService.verifyChain(body.fromSeq, body.toSeq);
    },
  );
}
