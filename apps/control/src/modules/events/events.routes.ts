import type { FastifyInstance } from 'fastify';
import { desc, lt, and, eq } from 'drizzle-orm';
import { db, worldActivityFeed } from '@mirrorgrid/db';
import { getOutboxRelay, getActivityProjector } from './events.service.js';

export async function eventsRoutes(fastify: FastifyInstance) {
  // 1. Query CQRS Activity Feed for a specific world
  fastify.get(
    '/worlds/:worldId/activity-feed',
    {
      preHandler: [fastify.requirePermission('experiments:read')],
    },
    async (req) => {
      const params = req.params as { worldId: string };
      const query = req.query as { limit?: string; before?: string };

      const limit = Math.min(100, Math.max(1, query.limit ? parseInt(query.limit, 10) : 50));
      const beforeTime = query.before ? new Date(query.before).getTime() : undefined;

      const conditions = [eq(worldActivityFeed.worldId, params.worldId)];
      if (beforeTime) {
        conditions.push(lt(worldActivityFeed.occurredAt, new Date(beforeTime)));
      }

      const rows = await db
        .select()
        .from(worldActivityFeed)
        .where(and(...conditions))
        .orderBy(desc(worldActivityFeed.occurredAt))
        .limit(limit);

      const nextCursor =
        rows.length === limit ? rows[rows.length - 1].occurredAt.toISOString() : null;

      return {
        data: rows,
        nextCursor,
      };
    },
  );

  // 2. Outbox Relay Health & Status
  fastify.get(
    '/admin/outbox/status',
    {
      preHandler: [fastify.requirePermission('topology:read')],
    },
    async () => {
      const relay = getOutboxRelay();
      return relay.getStatus();
    },
  );

  // 3. Rebuild CQRS Projections from Journal
  fastify.post(
    '/projections/:name/rebuild',
    {
      preHandler: [fastify.requirePermission('topology:write')],
    },
    async (req, reply) => {
      const params = req.params as { name: string };
      const body = (req.body ?? {}) as { worldId?: string };

      if (params.name !== 'world_activity_feed') {
        return reply.status(404).send({
          statusCode: 404,
          error: 'Not Found',
          message: `Unknown projection: ${params.name}`,
        });
      }

      const projector = getActivityProjector();
      const result = await projector.rebuildProjection(body.worldId);

      return {
        status: 'REBUILT',
        projection: params.name,
        replayedCount: result.replayedCount,
      };
    },
  );
}
