import type { FastifyPluginAsync } from 'fastify';
import { ExperimentController } from './experiment.controller.js';

export const experimentRoutes: FastifyPluginAsync = async (fastify) => {
  const controller = new ExperimentController();

  fastify.post('/', controller.create);
  fastify.get('/', controller.list);
  fastify.get('/:experimentId', controller.get);
  fastify.post('/:experimentId/start', controller.start);
  fastify.post('/:experimentId/abort', controller.abort);
  fastify.get('/:experimentId/status', controller.status);
  fastify.get('/:experimentId/runs/:runNumber/report', controller.report);
};
