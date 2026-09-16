import type { FastifyRequest, FastifyReply } from 'fastify';
import { FaultService } from './fault.service.js';
import { createFaultSpecSchema, injectFaultSchema, emergencyAbortSchema } from './fault.schema.js';
import { auditLogger } from '@mirrorgrid/security';

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

    void auditLogger.log({
      principal: req.principal ?? undefined,
      action: 'FAULT_INJECTED',
      resourceType: 'FAULT',
      resourceId: faultId,
      diff: {
        worldId,
        executionId: result.id,
        faultSpecId: result.faultSpecId,
      },
      clientIp: (req.headers['x-forwarded-for'] as string) || req.ip || '127.0.0.1',
    });

    const serialized = {
      ...result,
      scheduledStartMicros: result.scheduledStartMicros.toString(),
      scheduledDurationMicros: result.scheduledDurationMicros.toString(),
      actualStartMicros: result.actualStartMicros ? result.actualStartMicros.toString() : null,
      actualEndMicros: result.actualEndMicros ? result.actualEndMicros.toString() : null,
    };

    return reply.status(201).send({ data: serialized });
  }

  public async disarm(
    req: FastifyRequest<{ Params: { worldId: string; executionId: string } }>,
    reply: FastifyReply,
  ) {
    const { worldId, executionId } = req.params;
    const result = await this.service.disarmFault(worldId, executionId);

    void auditLogger.log({
      principal: req.principal ?? undefined,
      action: 'FAULT_DISARMED',
      resourceType: 'FAULT',
      resourceId: executionId,
      diff: {
        worldId,
        executionId,
      },
      clientIp: (req.headers['x-forwarded-for'] as string) || req.ip || '127.0.0.1',
    });

    const serialized = {
      ...result,
      scheduledStartMicros: result.scheduledStartMicros.toString(),
      scheduledDurationMicros: result.scheduledDurationMicros.toString(),
      actualStartMicros: result.actualStartMicros ? result.actualStartMicros.toString() : null,
      actualEndMicros: result.actualEndMicros ? result.actualEndMicros.toString() : null,
    };

    return reply.send({ data: serialized });
  }

  public async abort(req: FastifyRequest<{ Params: { worldId: string } }>, reply: FastifyReply) {
    const { worldId } = req.params;
    const body = emergencyAbortSchema.parse(req.body ?? {});
    const result = await this.service.emergencyAbort(worldId, body.reason);

    void auditLogger.log({
      principal: req.principal ?? undefined,
      action: 'CHAOS_ABORT',
      resourceType: 'CHAOS',
      resourceId: worldId,
      diff: {
        reason: body.reason,
        abortedCount: result.abortedCount,
      },
      clientIp: (req.headers['x-forwarded-for'] as string) || req.ip || '127.0.0.1',
    });

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
