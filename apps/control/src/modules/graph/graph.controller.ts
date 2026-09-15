import type { FastifyRequest, FastifyReply } from 'fastify';
import { AppError } from '@mirrorgrid/platform';
import { uuidSchema } from '@mirrorgrid/validation';
import { z } from 'zod';
import { GraphService } from './graph.service.js';
import { AuthService } from '../auth/auth.service.js';

const graphParamSchema = z.object({
  worldId: uuidSchema,
});

export class GraphController {
  constructor(
    private readonly service: GraphService = new GraphService(),
    private readonly authService: AuthService = new AuthService()
  ) {}

  private async getAuthContext(req: FastifyRequest) {
    const headerOrgId = req.headers['x-org-id'] as string | undefined;
    const headerUserId = req.headers['x-user-id'] as string | undefined;

    if (headerOrgId && headerUserId) {
      return { organizationId: headerOrgId, userId: headerUserId };
    }

    const token = req.cookies.mg_session;
    if (!token) {
      throw AppError.unauthorized('Authentication required');
    }

    const validated = await this.authService.validateSession(token);
    if (!validated || !validated.user.organizationId) {
      throw AppError.unauthorized('Session expired or invalid');
    }

    return {
      organizationId: validated.user.organizationId,
      userId: validated.user.id,
    };
  }

  public async getGraph(req: FastifyRequest, reply: FastifyReply) {
    await this.getAuthContext(req);
    const { worldId } = graphParamSchema.parse(req.params);

    const graphData = await this.service.getGraph(worldId);
    return reply.status(200).send({ data: graphData });
  }
}
