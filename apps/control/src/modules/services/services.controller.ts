import type { FastifyRequest, FastifyReply } from 'fastify';
import { AppError } from '@mirrorgrid/platform';
import { paginationQuerySchema, paginatedResult } from '@mirrorgrid/validation';
import { ServicesService } from './services.service.js';
import {
  createServiceSchema,
  updateServiceSchema,
  serviceWorldParamSchema,
  serviceParamSchema,
} from './services.schema.js';
import { AuthService } from '../auth/auth.service.js';

export class ServicesController {
  constructor(
    private readonly service: ServicesService = new ServicesService(),
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

  public async list(req: FastifyRequest, reply: FastifyReply) {
    await this.getAuthContext(req);
    const { worldId } = serviceWorldParamSchema.parse(req.params);
    const pagination = paginationQuerySchema.parse(req.query);

    const { items, total } = await this.service.listServices(
      worldId,
      pagination.page,
      pagination.limit
    );

    return reply.status(200).send(
      paginatedResult(items, total, pagination.page, pagination.limit)
    );
  }

  public async get(req: FastifyRequest, reply: FastifyReply) {
    await this.getAuthContext(req);
    const { worldId, serviceId } = serviceParamSchema.parse(req.params);

    const service = await this.service.getService(worldId, serviceId);
    return reply.status(200).send({ data: service });
  }

  public async create(req: FastifyRequest, reply: FastifyReply) {
    await this.getAuthContext(req);
    const { worldId } = serviceWorldParamSchema.parse(req.params);
    const input = createServiceSchema.parse(req.body);

    const service = await this.service.createService(worldId, input);
    return reply.status(201).send({ data: service });
  }

  public async update(req: FastifyRequest, reply: FastifyReply) {
    await this.getAuthContext(req);
    const { worldId, serviceId } = serviceParamSchema.parse(req.params);
    const input = updateServiceSchema.parse(req.body);

    const updated = await this.service.updateService(worldId, serviceId, input);
    return reply.status(200).send({ data: updated });
  }

  public async delete(req: FastifyRequest, reply: FastifyReply) {
    await this.getAuthContext(req);
    const { worldId, serviceId } = serviceParamSchema.parse(req.params);

    await this.service.deleteService(worldId, serviceId);
    return reply.status(204).send();
  }
}
