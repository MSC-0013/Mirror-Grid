import type { FastifyInstance } from 'fastify';

export interface DownstreamCall {
  serviceName: string;
  targetUrl: string;
  timeoutMs: number;
  retryAttempts?: number;
}

export interface SyntheticRouteConfig {
  path: string;
  method?: 'GET' | 'POST';
  cpuBurnMs?: number;
  baseLatencyMs?: number;
  errorProbabilityPpm?: number;
  downstreamCalls?: DownstreamCall[];
}

export interface ServiceState {
  serviceId: string;
  serviceName: string;
  routes: Map<string, SyntheticRouteConfig>;
}

export async function adminRoutes(fastify: FastifyInstance, state: ServiceState) {
  fastify.get('/admin/config', async () => {
    return {
      serviceId: state.serviceId,
      serviceName: state.serviceName,
      routes: Array.from(state.routes.values()),
    };
  });

  fastify.post<{ Body: { routes: SyntheticRouteConfig[] } }>(
    '/admin/routes',
    async (req, reply) => {
      const { routes } = req.body ?? {};
      if (!Array.isArray(routes)) {
        return reply.status(400).send({ error: 'routes array required' });
      }

      state.routes.clear();
      for (const r of routes) {
        state.routes.set(r.path, r);
      }

      return { status: 'ok', routeCount: state.routes.size };
    },
  );
}
