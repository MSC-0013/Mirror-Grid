import type { FastifyRequest, FastifyReply } from 'fastify';
import { ExperimentService } from './experiment.service.js';
import {
  createExperimentSchema,
  startExperimentSchema,
  abortExperimentSchema,
} from './experiment.schema.js';

export class ExperimentController {
  constructor(private readonly service = new ExperimentService()) {}

  public create = async (
    req: FastifyRequest<{ Params: { worldId: string } }>,
    reply: FastifyReply,
  ) => {
    const body = createExperimentSchema.parse(req.body);
    const exp = await this.service.create(req.params.worldId, body);
    return reply.status(201).send(exp);
  };

  public list = async (
    req: FastifyRequest<{ Params: { worldId: string } }>,
    reply: FastifyReply,
  ) => {
    const list = await this.service.list(req.params.worldId);
    return reply.status(200).send(list);
  };

  public get = async (
    req: FastifyRequest<{ Params: { experimentId: string } }>,
    reply: FastifyReply,
  ) => {
    const exp = await this.service.get(req.params.experimentId);
    return reply.status(200).send(exp);
  };

  public start = async (
    req: FastifyRequest<{ Params: { worldId: string; experimentId: string } }>,
    reply: FastifyReply,
  ) => {
    const body = startExperimentSchema.parse(req.body);
    const result = await this.service.start(req.params.worldId, req.params.experimentId, body);
    return reply.status(202).send(result);
  };

  public abort = async (
    req: FastifyRequest<{ Params: { experimentId: string } }>,
    reply: FastifyReply,
  ) => {
    const body = abortExperimentSchema.parse(req.body);
    const result = await this.service.abort(req.params.experimentId, body.reason);
    return reply.status(200).send(result);
  };

  public status = async (
    req: FastifyRequest<{ Params: { experimentId: string } }>,
    reply: FastifyReply,
  ) => {
    const result = await this.service.getStatus(req.params.experimentId);
    return reply.status(200).send(result);
  };

  public report = async (
    req: FastifyRequest<{ Params: { experimentId: string; runNumber: string } }>,
    reply: FastifyReply,
  ) => {
    const result = await this.service.getReport(
      req.params.experimentId,
      Number(req.params.runNumber),
    );
    return reply.status(200).send(result);
  };
}
