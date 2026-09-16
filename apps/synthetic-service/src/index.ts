import fastify, { type FastifyInstance } from 'fastify';
import { healthRoutes } from './routes/health.js';
import {
  adminRoutes,
  type ServiceState,
  type SyntheticRouteConfig,
  type DownstreamCall,
} from './routes/admin.js';
import { workloadRoutes } from './routes/workload.js';
import { RpcClient } from './engine/rpc-client.js';

export type { SyntheticRouteConfig, DownstreamCall };

export interface SyntheticServerOptions {
  serviceId?: string;
  serviceName?: string;
  servicePort?: number;
  initialRoutes?: SyntheticRouteConfig[];
}

export interface SyntheticInstance {
  app: FastifyInstance;
  serviceId: string;
  serviceName: string;
  servicePort: number;
  stop: () => Promise<void>;
}

export async function createSyntheticService(
  opts: SyntheticServerOptions = {},
): Promise<SyntheticInstance> {
  const serviceId = opts.serviceId ?? process.env.SERVICE_ID ?? 'synthetic-default';
  const serviceName = opts.serviceName ?? process.env.SERVICE_NAME ?? 'synthetic-service';
  const port = opts.servicePort ?? Number(process.env.SERVICE_PORT ?? 8080);

  const routesMap = new Map<string, SyntheticRouteConfig>();
  if (opts.initialRoutes) {
    for (const r of opts.initialRoutes) {
      routesMap.set(r.path, r);
    }
  }

  const state: ServiceState = {
    serviceId,
    serviceName,
    routes: routesMap,
  };

  const app = fastify({ logger: false });
  const rpcClient = new RpcClient();

  // Register routes
  await app.register(healthRoutes, { serviceId, serviceName });
  await app.register(adminRoutes, state);
  await app.register(workloadRoutes, { state, rpcClient });

  await app.listen({ port, host: '0.0.0.0' });

  return {
    app,
    serviceId,
    serviceName,
    servicePort: port,
    stop: async () => {
      await app.close();
    },
  };
}

// Auto-start if run directly
const isDirectRun = process.argv[1]?.endsWith('index.ts') || process.argv[1]?.endsWith('index.js');
if (isDirectRun) {
  createSyntheticService()
    .then((inst) => {
      console.log(`Synthetic service '${inst.serviceName}' listening on port ${inst.servicePort}`);
    })
    .catch((err) => {
      console.error('Failed to start synthetic service:', err);
      process.exit(1);
    });
}
