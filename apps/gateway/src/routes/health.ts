import type { FastifyInstance } from 'fastify';
import { fetch } from 'undici';
import { config } from '@mirrorgrid/config';

export async function gatewayHealthRoutes(fastify: FastifyInstance) {
  const controlBase = `http://127.0.0.1:${config.CONTROL_PORT}`;

  fastify.get('/live', async (_req, reply) => {
    return reply.status(200).send({ status: 'ok' });
  });

  fastify.get('/ready', async (_req, reply) => {
    try {
      const res = await fetch(`${controlBase}/health/ready`);
      if (res.ok) {
        return reply.status(200).send({ status: 'ok' });
      }
      const data = await res.json().catch(() => ({ status: 'not_ready' }));
      return reply.status(503).send(data);
    } catch {
      return reply.status(503).send({
        status: 'not_ready',
        dependencies: [
          {
            name: 'control-plane',
            status: 'UNHEALTHY',
            message: 'Cannot connect to control plane service',
          },
        ],
      });
    }
  });

  fastify.get('/status', async (_req, reply) => {
    try {
      const res = await fetch(`${controlBase}/health/status`);
      if (res.ok) {
        const data = await res.json();
        return reply.status(200).send(data);
      }
      return reply.status(200).send({
        status: 'DEGRADED',
        uptimeSeconds: process.uptime(),
        timestamp: new Date().toISOString(),
        components: [
          {
            name: 'control-plane',
            status: 'UNHEALTHY',
            isCritical: true,
            message: `Control plane returned HTTP ${res.status}`,
          },
        ],
      });
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      return reply.status(200).send({
        status: 'UNHEALTHY',
        uptimeSeconds: process.uptime(),
        timestamp: new Date().toISOString(),
        components: [
          {
            name: 'control-plane',
            status: 'UNHEALTHY',
            isCritical: true,
            message: msg,
          },
        ],
      });
    }
  });
}
