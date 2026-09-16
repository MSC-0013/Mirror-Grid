import fastify, { type FastifyInstance } from 'fastify';
import fastifyCookie from '@fastify/cookie';
import { ZodError } from 'zod';
import { config } from '@mirrorgrid/config';
import { createLogger } from '@mirrorgrid/logging';
import { AppError } from '@mirrorgrid/platform';
import { authRoutes } from './modules/auth/auth.routes.js';
import { worldsRoutes } from './modules/worlds/worlds.routes.js';
import { healthRoutes } from './modules/health/health.routes.js';
import { servicesRoutes } from './modules/services/index.js';
import { dependenciesRoutes } from './modules/dependencies/index.js';
import { workloadsRoutes } from './modules/workloads/index.js';
import { graphRoutes } from './modules/graph/index.js';
import { faultsRoutes, chaosRoutes } from './modules/faults/index.js';
import { breakersRoutes } from './modules/breakers/index.js';
import { runtimeRoutes } from './modules/runtime/index.js';
import { experimentRoutes } from './modules/experiments/index.js';
import { securityPlugin } from './plugins/security.plugin.js';
import { auditRoutes } from './modules/audit/audit.routes.js';
import { userRoutes } from './modules/users/user.routes.js';
import { jobsRoutes } from './modules/jobs/jobs.routes.js';

// Polyfill BigInt serialization for Fastify JSON responses
/* eslint-disable @typescript-eslint/no-explicit-any */
if (!(BigInt.prototype as any).toJSON) {
  (BigInt.prototype as any).toJSON = function () {
    return this.toString();
  };
}
/* eslint-enable @typescript-eslint/no-explicit-any */

export function buildServer(): FastifyInstance {
  const logger = createLogger({ name: 'control-plane' });
  const app = fastify({
    logger: false, // We log via custom correlation hooks if needed
  });

  // Cookie parsing support
  app.register(fastifyCookie, {
    secret: config.SESSION_SECRET,
  });

  // Security Plugin: Session auth, RBAC guards, adaptive rate limiting
  app.register(securityPlugin);

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

    logger.error({ err: error, requestId, url: req.url }, 'Unhandled server error');
    const fallback = AppError.internal();
    return reply.status(500).send(fallback.toEnvelope(requestId));
  });

  // Register Modules
  app.register(healthRoutes, { prefix: '/health' });
  app.register(authRoutes, { prefix: '/api/v1/auth' });
  app.register(userRoutes, { prefix: '/api/v1/users' });
  app.register(auditRoutes, { prefix: '/api/v1/audit-logs' });
  app.register(jobsRoutes, { prefix: '/api/v1/jobs' });
  app.register(worldsRoutes, { prefix: '/api/v1/worlds' });
  app.register(servicesRoutes, { prefix: '/api/v1/worlds/:worldId/services' });
  app.register(dependenciesRoutes, { prefix: '/api/v1/worlds/:worldId/dependencies' });
  app.register(workloadsRoutes, { prefix: '/api/v1/worlds/:worldId/workloads' });
  app.register(graphRoutes, { prefix: '/api/v1/worlds/:worldId/graph' });
  app.register(faultsRoutes, { prefix: '/api/v1/worlds/:worldId/faults' });
  app.register(chaosRoutes, { prefix: '/api/v1/worlds/:worldId/chaos' });
  app.register(breakersRoutes, { prefix: '/api/v1/worlds/:worldId/breakers' });
  app.register(runtimeRoutes, { prefix: '/api/v1/worlds/:worldId/runtime' });
  app.register(experimentRoutes, { prefix: '/api/v1/worlds/:worldId/experiments' });

  return app;
}

export async function startServer() {
  const app = buildServer();
  const port = config.CONTROL_PORT;
  const host = '0.0.0.0';

  try {
    await app.listen({ port, host });
    console.log(`Control plane running at http://${host}:${port}`);
    return app;
  } catch (err) {
    console.error('Failed to start control plane:', err);
    process.exit(1);
  }
}

// Auto-start if run directly
const isDirectRun =
  process.argv[1]?.endsWith('server.ts') || process.argv[1]?.endsWith('server.js');
if (isDirectRun) {
  void startServer();
}
