import type { FastifyRequest, FastifyReply } from 'fastify';
import { BreakerService } from './breaker.service.js';
import { tripBreakerSchema } from './breaker.schema.js';

export class BreakerController {
  private readonly service: BreakerService;

  constructor(service?: BreakerService) {
    this.service = service ?? new BreakerService();
  }

  public async list(req: FastifyRequest<{ Params: { worldId: string } }>, reply: FastifyReply) {
    const { worldId } = req.params;
    const result = await this.service.listBreakers(worldId);
    return reply.send({ data: result });
  }

  public async trip(
    req: FastifyRequest<{ Params: { worldId: string; breakerId: string } }>,
    reply: FastifyReply,
  ) {
    const { worldId, breakerId } = req.params;
    const body = tripBreakerSchema.parse(req.body ?? {});
    const result = await this.service.tripBreaker(worldId, breakerId, body.reason);
    return reply.send({ data: result });
  }

  public async reset(
    req: FastifyRequest<{ Params: { worldId: string; breakerId: string } }>,
    reply: FastifyReply,
  ) {
    const { worldId, breakerId } = req.params;
    const result = await this.service.resetBreaker(worldId, breakerId);
    return reply.send({ data: result });
  }

  public async listTransitions(
    req: FastifyRequest<{ Params: { worldId: string } }>,
    reply: FastifyReply,
  ) {
    const { worldId } = req.params;
    const result = await this.service.listTransitions(worldId);
    return reply.send({ data: result });
  }
}
