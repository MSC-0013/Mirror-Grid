import type { FastifyRequest, FastifyReply } from 'fastify';
import { RuntimeService } from './runtime.service.js';
import { deployRuntimeSchema } from './runtime.schema.js';

export class RuntimeController {
  private readonly service: RuntimeService;

  constructor(service?: RuntimeService) {
    this.service = service ?? new RuntimeService();
  }

  public async deploy(req: FastifyRequest<{ Params: { worldId: string } }>, reply: FastifyReply) {
    const { worldId } = req.params;
    const body = deployRuntimeSchema.parse(req.body ?? {});
    const result = await this.service.deploy(worldId, body);
    return reply.status(202).send({ data: result });
  }

  public async fleet(req: FastifyRequest<{ Params: { worldId: string } }>, reply: FastifyReply) {
    const { worldId } = req.params;
    const result = await this.service.getFleet(worldId);
    return reply.send({ data: result });
  }

  public async restart(
    req: FastifyRequest<{ Params: { worldId: string; containerId: string } }>,
    reply: FastifyReply,
  ) {
    const { worldId, containerId } = req.params;
    const result = await this.service.restartContainer(worldId, containerId);
    return reply.send({ data: result });
  }

  public async logs(
    req: FastifyRequest<{ Params: { worldId: string; containerId: string } }>,
    reply: FastifyReply,
  ) {
    const { worldId, containerId } = req.params;
    const result = await this.service.getLogs(worldId, containerId);
    return reply.send({ data: result });
  }
}
