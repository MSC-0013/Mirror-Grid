import type { FastifyRequest, FastifyReply } from 'fastify';
import { FaultService } from './fault.service.js';
import { createFaultSpecSchema, injectFaultSchema, emergencyAbortSchema } from './fault.schema.js';

export class FaultController {
  private readonly service: FaultService;

  constructor(service?: FaultService) {
    this.service = service ?? new FaultService();
  }

  public async create(req: FastifyRequest<{ Params: { worldId: string } }>, reply: FastifyReply) {
    const { worldId } = req.params;
    const body = createFaultSpecSchema.parse(req.body);
    const result = await this.service.createFaultSpec(worldId, body);
    return reply.status(201).send({ data: result });
  }

  public async list(req: FastifyRequest<{ Params: { worldId: string } }>, reply: FastifyReply) {
    const { worldId } = req.params;
    const result = await this.service.listFaultSpecs(worldId);
    return reply.send({ data: result });
  }

  public async get(
    req: FastifyRequest<{ Params: { worldId: string; faultId: string } }>,
    reply: FastifyReply,
  ) {
    const { worldId, faultId } = req.params;
    const result = await this.service.getFaultSpec(worldId, faultId);
    return reply.send({ data: result });
  }

  public async inject(
    req: FastifyRequest<{ Params: { worldId: string; faultId: string } }>,
    reply: FastifyReply,
  ) {
    const { worldId, faultId } = req.params;
    const body = injectFaultSchema.parse(req.body ?? {});
    const result = await this.service.injectFault(worldId, faultId, body);
    return reply.status(201).send({ data: result });
  }

  public async disarm(
    req: FastifyRequest<{ Params: { worldId: string; executionId: string } }>,
    reply: FastifyReply,
  ) {
    const { worldId, executionId } = req.params;
    const result = await this.service.disarmFault(worldId, executionId);
    return reply.send({ data: result });
  }

  public async abort(req: FastifyRequest<{ Params: { worldId: string } }>, reply: FastifyReply) {
    const { worldId } = req.params;
    const body = emergencyAbortSchema.parse(req.body ?? {});
    const result = await this.service.emergencyAbort(worldId, body.reason);
    return reply.send({ data: result });
  }

  public async listActive(
    req: FastifyRequest<{ Params: { worldId: string } }>,
    reply: FastifyReply,
  ) {
    const { worldId } = req.params;
    const result = await this.service.getActiveFaults(worldId);
    return reply.send({ data: result });
  }
}
