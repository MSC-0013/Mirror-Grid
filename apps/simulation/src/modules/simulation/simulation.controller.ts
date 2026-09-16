import type { FastifyRequest, FastifyReply } from 'fastify';
import { simulationService, SimulationService } from './simulation.service.js';
import { createRunSchema, runIdParamSchema, getMetricsQuerySchema } from './simulation.schema.js';

export class SimulationController {
  constructor(private readonly service: SimulationService = simulationService) {}

  async createRun(req: FastifyRequest, reply: FastifyReply) {
    const input = createRunSchema.parse(req.body);
    const result = await this.service.createRun(input);
    return reply.status(201).send({
      success: true,
      data: result,
      meta: { timestamp: new Date().toISOString() },
    });
  }

  async startRun(req: FastifyRequest, reply: FastifyReply) {
    const { id } = runIdParamSchema.parse(req.params);
    const result = await this.service.startRun(id);
    return reply.status(202).send({
      success: true,
      data: result,
      meta: { timestamp: new Date().toISOString() },
    });
  }

  async stopRun(req: FastifyRequest, reply: FastifyReply) {
    const { id } = runIdParamSchema.parse(req.params);
    const result = await this.service.stopRun(id);
    return reply.status(202).send({
      success: true,
      data: result,
      meta: { timestamp: new Date().toISOString() },
    });
  }

  async getStatus(req: FastifyRequest, reply: FastifyReply) {
    const { id } = runIdParamSchema.parse(req.params);
    const result = await this.service.getRunStatus(id);
    return reply.status(200).send({
      success: true,
      data: result,
      meta: { timestamp: new Date().toISOString() },
    });
  }

  async getMetrics(req: FastifyRequest, reply: FastifyReply) {
    const { id } = runIdParamSchema.parse(req.params);
    const query = getMetricsQuerySchema.parse(req.query);
    const result = await this.service.getMetrics(id, query.serviceId, query.fromUs, query.toUs);
    return reply.status(200).send({
      success: true,
      data: result,
      meta: { timestamp: new Date().toISOString() },
    });
  }
}

export const simulationController = new SimulationController();
