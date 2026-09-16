import fastify, { type FastifyInstance } from 'fastify';
import fastifyCors from '@fastify/cors';
import fastifyCookie from '@fastify/cookie';
import fastifyProxy from '@fastify/http-proxy';
import { config } from '@mirrorgrid/config';
import { createLogger } from '@mirrorgrid/logging';
import { AppError } from '@mirrorgrid/platform';
import { requestIdPlugin } from './plugins/request-id.js';
import { swaggerPlugin } from './plugins/swagger.js';
import { gatewayHealthRoutes } from './routes/health.js';

export async function buildGateway(): Promise<FastifyInstance> {
  const logger = createLogger({ name: 'api-gateway' });
  const app = fastify({
    logger: false,
  });

  // CORS support
  await app.register(fastifyCors, {
    origin: ['http://localhost:3000', 'http://127.0.0.1:3000'],
    credentials: true,
    methods: ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS'],
    allowedHeaders: ['Content-Type', 'Authorization', 'x-request-id', 'x-correlation-id'],
    exposedHeaders: ['x-request-id'],
  });

  // Cookies
  await app.register(fastifyCookie, {
    secret: config.SESSION_SECRET,
  });

  // Request ID injection
  await app.register(requestIdPlugin);

  // OpenAPI Swagger Documentation
  await app.register(swaggerPlugin);

  // Health routes
  await app.register(gatewayHealthRoutes, { prefix: '/health' });

  // Standard Error Handler
  app.setErrorHandler((error, req, reply) => {
    const requestId = (req.headers['x-request-id'] as string) || req.id;
    if (error instanceof AppError) {
      return reply.status(error.statusCode).send(error.toEnvelope(requestId));
    }
    logger.error({ err: error, requestId, url: req.url }, 'Gateway error');
    const fallback = AppError.internal();
    return reply.status(500).send(fallback.toEnvelope(requestId));
  });

  // Reverse Proxy to Simulation Service
  await app.register(fastifyProxy, {
    upstream: `http://127.0.0.1:${config.SIMULATION_PORT}`,
    prefix: '/api/v1/simulation',
    rewritePrefix: '/api/v1/simulation',
    http2: false,
  });

  // Reverse Proxy to Control Plane for all /api/v1/* calls
  await app.register(fastifyProxy, {
    upstream: `http://127.0.0.1:${config.CONTROL_PORT}`,
    prefix: '/api/v1',
    rewritePrefix: '/api/v1',
    http2: false,
  });

  return app;
}

export async function startGateway() {
  const app = await buildGateway();
  const port = config.GATEWAY_PORT;
  const host = '0.0.0.0';

  try {
    await app.listen({ port, host });
    console.log(`API Gateway running at http://${host}:${port}`);
    console.log(`OpenAPI docs at http://${host}:${port}/docs`);
    console.log(`OpenAPI spec at http://${host}:${port}/openapi.json`);
    return app;
  } catch (err) {
    console.error('Failed to start API Gateway:', err);
    process.exit(1);
  }
}

// Auto-start if run directly
const isDirectRun = process.argv[1]?.endsWith('server.ts') || process.argv[1]?.endsWith('server.js');
if (isDirectRun) {
  void startGateway();
}
