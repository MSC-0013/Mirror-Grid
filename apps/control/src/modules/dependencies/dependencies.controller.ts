import type { FastifyRequest, FastifyReply } from 'fastify';
import { AppError } from '@mirrorgrid/platform';
import { DependenciesService } from './dependencies.service.js';
import {
  createDependencySchema,
  updateDependencySchema,
  dependencyWorldParamSchema,
  dependencyParamSchema,
} from './dependencies.schema.js';
import { AuthService } from '../auth/auth.service.js';

export class DependenciesController {
  constructor(
    private readonly service: DependenciesService = new DependenciesService(),
    private readonly authService: AuthService = new AuthService(),
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

  public async list(req: FastifyRequest, reply: FastifyReply) {
    await this.getAuthContext(req);
    const { worldId } = dependencyWorldParamSchema.parse(req.params);

    const items = await this.service.listDependencies(worldId);
    return reply.status(200).send({ data: items });
  }

  public async get(req: FastifyRequest, reply: FastifyReply) {
    await this.getAuthContext(req);
    const { worldId, id } = dependencyParamSchema.parse(req.params);

    const item = await this.service.getDependency(worldId, id);
    return reply.status(200).send({ data: item });
  }

  public async create(req: FastifyRequest, reply: FastifyReply) {
    await this.getAuthContext(req);
    const { worldId } = dependencyWorldParamSchema.parse(req.params);
    const input = createDependencySchema.parse(req.body);

    const created = await this.service.createDependency(worldId, input);
    return reply.status(201).send({ data: created });
  }

  public async update(req: FastifyRequest, reply: FastifyReply) {
    await this.getAuthContext(req);
    const { worldId, id } = dependencyParamSchema.parse(req.params);
    const input = updateDependencySchema.parse(req.body);

    const updated = await this.service.updateDependency(worldId, id, input);
    return reply.status(200).send({ data: updated });
  }

  public async delete(req: FastifyRequest, reply: FastifyReply) {
    await this.getAuthContext(req);
    const { worldId, id } = dependencyParamSchema.parse(req.params);

    await this.service.deleteDependency(worldId, id);
    return reply.status(204).send();
  }
}
