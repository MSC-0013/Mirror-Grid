import type { FastifyRequest, FastifyReply } from 'fastify';
import { AppError } from '@mirrorgrid/platform';
import { paginationQuerySchema, paginatedResult } from '@mirrorgrid/validation';
import { WorldsService } from './worlds.service.js';
import { createWorldSchema, updateWorldSchema, worldParamSchema } from './worlds.schema.js';
import { AuthService } from '../auth/auth.service.js';
import { auditLogger } from '@mirrorgrid/security';

export class WorldsController {
  constructor(
    private readonly service: WorldsService = new WorldsService(),
    private readonly authService: AuthService = new AuthService(),
  ) {}

  private async getAuthContext(req: FastifyRequest) {
    if (req.principal && req.principal.organizationId) {
      return { organizationId: req.principal.organizationId, userId: req.principal.id };
    }

    // 1. Check if headers were forwarded by Gateway
    const headerOrgId = req.headers['x-org-id'] as string | undefined;
    const headerUserId = req.headers['x-user-id'] as string | undefined;

    if (headerOrgId && headerUserId) {
      return { organizationId: headerOrgId, userId: headerUserId };
    }

    // 2. Fall back to direct session cookie inspection
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
    const { organizationId } = await this.getAuthContext(req);
    const pagination = paginationQuerySchema.parse(req.query);

    const { items, total } = await this.service.listWorlds(
      organizationId,
      pagination.page,
      pagination.limit,
    );

    const serializedItems = items.map((w) => ({
      ...w,
      eventSeq: w.eventSeq.toString(),
    }));

    return reply
      .status(200)
      .send(paginatedResult(serializedItems, total, pagination.page, pagination.limit));
  }

  public async get(req: FastifyRequest, reply: FastifyReply) {
    const { organizationId } = await this.getAuthContext(req);
    const params = worldParamSchema.parse(req.params);

    const world = await this.service.getWorld(organizationId, params.id);
    return reply.status(200).send({
      data: {
        ...world,
        eventSeq: world.eventSeq.toString(),
      },
    });
  }

  public async create(req: FastifyRequest, reply: FastifyReply) {
    const { organizationId, userId } = await this.getAuthContext(req);
    const parse = createWorldSchema.safeParse(req.body);
    if (!parse.success) {
      throw AppError.badRequest('Validation failed', parse.error.format());
    }

    const world = await this.service.createWorld(organizationId, userId, parse.data);

    void auditLogger.log({
      principal: req.principal ?? { id: userId },
      action: 'WORLD_CREATED',
      resourceType: 'WORLD',
      resourceId: world.id,
      diff: { after: { name: world.name, runtimeMode: world.runtimeMode } },
      clientIp: req.ip || '127.0.0.1',
    });

    return reply.status(201).send({
      data: {
        ...world,
        eventSeq: world.eventSeq.toString(),
      },
    });
  }

  public async update(req: FastifyRequest, reply: FastifyReply) {
    const { organizationId } = await this.getAuthContext(req);
    const params = worldParamSchema.parse(req.params);
    const parse = updateWorldSchema.safeParse(req.body);
    if (!parse.success) {
      throw AppError.badRequest('Validation failed', parse.error.format());
    }

    const world = await this.service.updateWorld(organizationId, params.id, parse.data);
    return reply.status(200).send({
      data: {
        ...world,
        eventSeq: world.eventSeq.toString(),
      },
    });
  }

  public async delete(req: FastifyRequest, reply: FastifyReply) {
    const { organizationId, userId } = await this.getAuthContext(req);
    const params = worldParamSchema.parse(req.params);

    await this.service.deleteWorld(organizationId, params.id);

    void auditLogger.log({
      principal: req.principal ?? { id: userId },
      action: 'WORLD_DELETED',
      resourceType: 'WORLD',
      resourceId: params.id,
      diff: { before: { id: params.id } },
      clientIp: req.ip || '127.0.0.1',
    });

    return reply.status(204).send();
  }
}
