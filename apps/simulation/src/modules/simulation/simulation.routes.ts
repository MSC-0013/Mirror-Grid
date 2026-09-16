import type { FastifyInstance } from 'fastify';
import { simulationController, SimulationController } from './simulation.controller.js';

export async function simulationRoutes(
  app: FastifyInstance,
  options?: { controller?: SimulationController },
) {
  const controller = options?.controller ?? simulationController;

  app.post('/runs', (req, reply) => controller.createRun(req, reply));
  app.post('/runs/:id/start', (req, reply) => controller.startRun(req, reply));
  app.post('/runs/:id/stop', (req, reply) => controller.stopRun(req, reply));
  app.get('/runs/:id/status', (req, reply) => controller.getStatus(req, reply));
  app.get('/runs/:id/metrics', (req, reply) => controller.getMetrics(req, reply));
}
