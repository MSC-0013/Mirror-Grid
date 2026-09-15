import type { FastifyInstance } from 'fastify';
import swagger from '@fastify/swagger';
import swaggerUi from '@fastify/swagger-ui';

export async function swaggerPlugin(fastify: FastifyInstance) {
  await fastify.register(swagger, {
    openapi: {
      openapi: '3.1.0',
      info: {
        title: 'MIRRORGRID API',
        description: 'Distributed-systems reliability laboratory OpenAPI specification',
        version: '0.1.0',
      },
      servers: [
        {
          url: 'http://localhost:4000',
          description: 'Local Gateway API',
        },
      ],
      components: {
        securitySchemes: {
          cookieAuth: {
            type: 'apiKey',
            in: 'cookie',
            name: 'mg_session',
          },
        },
      },
    },
  });

  await fastify.register(swaggerUi, {
    routePrefix: '/docs',
    uiConfig: {
      docExpansion: 'list',
      deepLinking: false,
    },
  });

  // Expose raw OpenAPI JSON at /openapi.json per contract
  fastify.get('/openapi.json', async (_req, reply) => {
    return reply.status(200).send(fastify.swagger());
  });
}
