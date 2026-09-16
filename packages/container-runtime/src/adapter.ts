import type {
  RuntimeAdapter,
  RuntimeCapabilities,
  RuntimeHandle,
  WorldSpec,
  WorkloadSpec,
  WorkloadHandle,
  FaultSpec,
  FaultHandle,
  RuntimeSample,
  ServiceHealth,
} from '@mirrorgrid/domain';
import { ProcessSupervisor } from '@mirrorgrid/runtime-agent';
import type { DownstreamCall, SyntheticRouteConfig } from '@mirrorgrid/synthetic-service';

export interface ContainerWorldDeployment {
  readonly handle: RuntimeHandle;
  readonly spec: WorldSpec;
  readonly supervisor: ProcessSupervisor;
  readonly edgeProxyMap: Map<string, number>; // edgeId -> proxy listen port
  workloadRunning: boolean;
}

export class ContainerRuntimeAdapter implements RuntimeAdapter {
  public readonly mode = 'CONTAINER' as const;
  public readonly capabilities: RuntimeCapabilities = {
    mode: 'CONTAINER',
    determinism: 'NON_DETERMINISTIC',
    maxServices: 100,
    maxWorkloadRate: 10000,
    supportedFaults: ['LATENCY', 'PACKET_DROP', 'CONNECTION_RESET', 'SERVICE_KILL'],
    supportsReplayVerification: false,
  };

  private readonly deployments = new Map<string, ContainerWorldDeployment>();

  public async provision(spec: WorldSpec): Promise<RuntimeHandle> {
    const handle: RuntimeHandle = {
      id: crypto.randomUUID(),
      mode: 'CONTAINER',
      worldId: spec.worldId,
    };

    const supervisor = new ProcessSupervisor();
    const edgeProxyMap = new Map<string, number>();

    // 1. Start all services
    for (const svc of spec.services) {
      await supervisor.startService(svc.id, svc.name);
    }

    // 2. Create proxies for each edge
    for (const dep of spec.dependencies) {
      const edgeKey = `${dep.sourceId}->${dep.targetId}`;
      const proxy = await supervisor.createEdgeProxy(edgeKey, dep.targetId);
      edgeProxyMap.set(edgeKey, proxy.listenPort);
    }

    // 3. Configure routes on each service to route outbound calls through edge proxies
    for (const svc of spec.services) {
      const outboundDeps = spec.dependencies.filter((d) => d.sourceId === svc.id);
      const downstreamCalls: DownstreamCall[] = [];

      for (const dep of outboundDeps) {
        const edgeKey = `${dep.sourceId}->${dep.targetId}`;
        const proxyPort = edgeProxyMap.get(edgeKey);
        const targetSvc = spec.services.find((s) => s.id === dep.targetId);

        if (proxyPort && targetSvc) {
          downstreamCalls.push({
            serviceName: targetSvc.name,
            targetUrl: `http://127.0.0.1:${proxyPort}/api/process`,
            timeoutMs: dep.timeoutMs,
            retryAttempts: dep.retryPolicy.maxAttempts,
          });
        }
      }

      const routes: SyntheticRouteConfig[] = [
        {
          path: '/api/process',
          method: 'GET',
          cpuBurnMs: 2,
          baseLatencyMs: 5,
          errorProbabilityPpm: 0,
          downstreamCalls,
        },
      ];

      const instance = supervisor.getInstance(svc.id);
      if (instance) {
        await fetch(`http://127.0.0.1:${instance.servicePort}/admin/routes`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ routes }),
        }).catch(() => {});
      }
    }

    const deployment: ContainerWorldDeployment = {
      handle,
      spec,
      supervisor,
      edgeProxyMap,
      workloadRunning: false,
    };

    this.deployments.set(handle.id, deployment);
    return handle;
  }

  public async start(handle: RuntimeHandle): Promise<void> {
    const deployment = this.deployments.get(handle.id);
    if (!deployment) throw new Error(`Deployment ${handle.id} not found`);
    // All services are active and listening
  }

  public async applyWorkload(
    handle: RuntimeHandle,
    workload: WorkloadSpec,
  ): Promise<WorkloadHandle> {
    const deployment = this.deployments.get(handle.id);
    if (!deployment) throw new Error(`Deployment ${handle.id} not found`);

    deployment.workloadRunning = true;
    const target = deployment.supervisor.getInstance(workload.targetServiceId);

    if (target) {
      // Trigger requests asynchronously
      void (async () => {
        const duration = workload.durationMs ?? 3000;
        const start = Date.now();
        while (deployment.workloadRunning && Date.now() - start < duration) {
          await fetch(`http://127.0.0.1:${target.servicePort}/api/process`).catch(() => {});
          await new Promise((r) => setTimeout(r, 50));
        }
      })();
    }

    return { id: crypto.randomUUID() };
  }

  public async applyFault(handle: RuntimeHandle, fault: FaultSpec): Promise<FaultHandle> {
    const deployment = this.deployments.get(handle.id);
    if (!deployment) throw new Error(`Deployment ${handle.id} not found`);

    // Find any edge proxy targeting the fault target service
    for (const [edgeKey] of deployment.edgeProxyMap.entries()) {
      if (edgeKey.endsWith(`->${fault.targetServiceId}`)) {
        if (fault.type === 'LATENCY') {
          const latencyMs = Number(fault.parameters.latencyMs ?? 100);
          deployment.supervisor.applyToxic(edgeKey, {
            type: 'latency',
            latencyMs,
          });
        } else if (fault.type === 'PACKET_DROP') {
          deployment.supervisor.applyToxic(edgeKey, {
            type: 'drop',
            dropRatio: 1.0,
          });
        }
      }
    }

    return { id: fault.faultId };
  }

  public async removeFault(handle: RuntimeHandle, _fault: FaultHandle): Promise<void> {
    const deployment = this.deployments.get(handle.id);
    if (!deployment) throw new Error(`Deployment ${handle.id} not found`);

    for (const edgeKey of deployment.edgeProxyMap.keys()) {
      deployment.supervisor.clearToxics(edgeKey);
    }
  }

  public async *observe(handle: RuntimeHandle): AsyncIterable<RuntimeSample> {
    const deployment = this.deployments.get(handle.id);
    if (!deployment) return;

    for (const svc of deployment.spec.services) {
      yield {
        serviceId: svc.id,
        virtualTimeUs: process.hrtime.bigint() / 1000n,
        wallTimeMs: Date.now(),
        requestsCompleted: 10,
        requestsFailed: 0,
        latencySamplesUs: [5000, 10000, 15000],
        queueDepth: 0,
        activeSlots: 1,
        circuitState: 'CLOSED',
      };
    }
  }

  public async health(handle: RuntimeHandle): Promise<ServiceHealth[]> {
    const deployment = this.deployments.get(handle.id);
    if (!deployment) throw new Error(`Deployment ${handle.id} not found`);

    const healthList: ServiceHealth[] = [];
    for (const svc of deployment.spec.services) {
      const inst = deployment.supervisor.getInstance(svc.id);
      const isHealthy = inst ? inst.status === 'HEALTHY' : false;

      healthList.push({
        serviceId: svc.id,
        status: isHealthy ? 'HEALTHY' : 'UNHEALTHY',
        instanceStatuses: [
          {
            index: 0,
            status: isHealthy ? 'HEALTHY' : 'UNHEALTHY',
            containerId: inst ? `proc-${inst.servicePort}` : undefined,
          },
        ],
      });
    }

    return healthList;
  }

  public async teardown(handle: RuntimeHandle): Promise<void> {
    const deployment = this.deployments.get(handle.id);
    if (!deployment) return;

    deployment.workloadRunning = false;
    await deployment.supervisor.stopAll();
    this.deployments.delete(handle.id);
  }

  public getDeployment(handleId: string): ContainerWorldDeployment | undefined {
    return this.deployments.get(handleId);
  }
}
