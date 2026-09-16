import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { userService } from './user.service.js';
import type { RoleCode } from '@mirrorgrid/security';

const assignRolesSchema = z.object({
  roles: z.array(z.enum(['ADMIN', 'OPERATOR', 'VIEWER'])).min(1),
});

export async function userRoutes(fastify: FastifyInstance) {
  fastify.get(
    '/',
    {
      preHandler: [fastify.requirePermission('users:manage')],
    },
    async () => {
      return userService.listUsers();
    },
  );

  fastify.put(
    '/:id/roles',
    {
      preHandler: [fastify.requirePermission('users:manage')],
    },
    async (req) => {
      const params = req.params as { id: string };
      const body = assignRolesSchema.parse(req.body);
      const principal = req.principal!;

      return userService.assignRoles(params.id, body.roles as RoleCode[], principal);
    },
  );
}
