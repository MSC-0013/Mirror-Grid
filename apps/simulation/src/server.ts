import fastify, { type FastifyInstance } from 'fastify';
import fastifyCors from '@fastify/cors';
import { ZodError } from 'zod';
import { config } from '@mirrorgrid/config';
import { createLogger } from '@mirrorgrid/logging';
import { AppError } from '@mirrorgrid/platform';
import { simulationRoutes } from './modules/simulation/index.js';

export function buildServer(): FastifyInstance {
  const logger = createLogger({ name: 'simulation-service' });
  const app = fastify({
    logger: false,
  });

  app.register(fastifyCors, {
    origin: true,
    credentials: true,
  });

  // Standardized Error Handler
  app.setErrorHandler((error, req, reply) => {
    const requestId = (req.headers['x-request-id'] as string) || req.id;

    if (error instanceof AppError) {
      return reply.status(error.statusCode).send(error.toEnvelope(requestId));
    }

    if (error instanceof ZodError) {
      const appErr = AppError.badRequest('Validation failed', error.format());
      return reply.status(400).send(appErr.toEnvelope(requestId));
    }

    logger.error({ err: error, requestId, url: req.url }, 'Unhandled simulation error');
    const fallback = AppError.internal();
    return reply.status(500).send(fallback.toEnvelope(requestId));
  });

  // Health endpoint
  app.get('/health', async (_req, reply) => {
    return reply.status(200).send({ status: 'ok', service: 'simulation' });
  });

  // Register Simulation Routes
  app.register(simulationRoutes, { prefix: '/api/v1/simulation' });

  return app;
}

export async function startServer() {
  const app = buildServer();
  const port = config.SIMULATION_PORT;
  const host = '0.0.0.0';

  try {
    await app.listen({ port, host });
    console.log(`Simulation service running at http://${host}:${port}`);
    return app;
  } catch (err) {
    console.error('Failed to start simulation service:', err);
    process.exit(1);
  }
}

const isDirectRun =
  process.argv[1]?.endsWith('server.ts') || process.argv[1]?.endsWith('server.js');
if (isDirectRun) {
  void startServer();
}
