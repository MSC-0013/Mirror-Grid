import type {
  RuntimeAdapter,
  RuntimeCapabilities,
  RuntimeHandle,
  WorldSpec,
  WorkloadSpec as DomainWorkloadSpec,
  WorkloadHandle,
  FaultSpec,
  FaultHandle,
  RuntimeSample,
  ServiceHealth,
} from '@mirrorgrid/domain';
import {
  SimEngine,
  type EngineWorldSpec,
  type EngineServiceSpec,
  type EngineRunResult,
} from '@mirrorgrid/sim';
import type { EdgeSpec } from '@mirrorgrid/sim/queueing';
import type { WorkloadSpec as SimWorkloadSpec } from '@mirrorgrid/sim/workload';
import { FastDriver, RealtimeDriver, type ClockDriver } from '@mirrorgrid/sim/clock';

export interface ProvisionedRun {
  readonly handle: RuntimeHandle;
  readonly spec: WorldSpec;
  readonly engine: SimEngine;
  workload?: SimWorkloadSpec;
  driver?: ClockDriver;
  runPromise?: Promise<EngineRunResult>;
  lastResult?: EngineRunResult;
  readonly sampleBuffer: RuntimeSample[];
}

export class LogicalRuntimeAdapter implements RuntimeAdapter {
  readonly mode = 'LOGICAL' as const;
  readonly capabilities: RuntimeCapabilities = {
    mode: 'LOGICAL',
    determinism: 'DETERMINISTIC',
    maxServices: 1000,
    maxWorkloadRate: 50000,
    supportedFaults: ['LATENCY', 'ERROR_RATE', 'TIMEOUT', 'QUEUE_BACKLOG'],
    supportsReplayVerification: true,
  };

  private readonly runs = new Map<string, ProvisionedRun>();

  async provision(spec: WorldSpec): Promise<RuntimeHandle> {
    const handle: RuntimeHandle = {
      id: crypto.randomUUID(),
      mode: 'LOGICAL',
      worldId: spec.worldId,
    };

    const targetServiceIds = new Set(spec.dependencies.map((d) => d.targetId));
    const entryService = spec.services.find((s) => !targetServiceIds.has(s.id)) ?? spec.services[0];

    if (!entryService) {
      throw new Error('Cannot provision world with no services');
    }

    const engineServices: EngineServiceSpec[] = spec.services.map((s) => ({
      id: s.id,
      name: s.name,
      concurrencyLimit: s.concurrencyLimit,
      queueCapacity: s.queueCapacity,
      serviceTimeTable: typeof s.config?.serviceTimeTable === 'string' ? s.config.serviceTimeTable : 'default_service',
    }));

    const engineEdges: EdgeSpec[] = spec.dependencies.map((d) => ({
      sourceId: d.sourceId,
      targetId: d.targetId,
      timeoutMs: d.timeoutMs,
    }));

    const engineSpec: EngineWorldSpec = {
      worldId: spec.worldId,
      services: engineServices,
      edges: engineEdges,
      entryServiceId: entryService.id,
      requestTimeoutMs: 5000,
    };

    const engine = new SimEngine(engineSpec);
    const provisioned: ProvisionedRun = {
      handle,
      spec,
      engine,
      sampleBuffer: [],
    };

    this.runs.set(handle.id, provisioned);
    return handle;
  }

  async applyWorkload(handle: RuntimeHandle, workload: DomainWorkloadSpec): Promise<WorkloadHandle> {
    const run = this.runs.get(handle.id);
    if (!run) {
      throw new Error(`Run not found: ${handle.id}`);
    }

    const simWorkload: SimWorkloadSpec = {
      pattern: workload.pattern,
      baseRatePerSecond: workload.baseRate,
      peakRatePerSecond: workload.peakRate,
      durationUs: BigInt(workload.durationMs ?? 10000) * 1000n,
    };

    run.workload = simWorkload;
    return { id: crypto.randomUUID() };
  }

  async applyFault(handle: RuntimeHandle, fault: FaultSpec): Promise<FaultHandle> {
    const run = this.runs.get(handle.id);
    if (!run) {
      throw new Error(`Run not found: ${handle.id}`);
    }
    return { id: fault.faultId || crypto.randomUUID() };
  }

  async removeFault(handle: RuntimeHandle, _fault: FaultHandle): Promise<void> {
    const run = this.runs.get(handle.id);
    if (!run) {
      throw new Error(`Run not found: ${handle.id}`);
    }
  }

  async start(handle: RuntimeHandle, driverType: 'FAST' | 'REALTIME' = 'FAST'): Promise<void> {
    const run = this.runs.get(handle.id);
    if (!run) {
      throw new Error(`Run not found: ${handle.id}`);
    }

    const workload: SimWorkloadSpec = run.workload ?? {
      pattern: 'CONSTANT',
      baseRatePerSecond: 100,
      durationUs: 10_000_000n,
    };

    const driver = driverType === 'REALTIME' ? new RealtimeDriver() : new FastDriver();
    run.driver = driver;

    run.runPromise = run.engine.run({
      seed: run.spec.seed,
      workload,
      driver,
      retainSamples: true,
      onMetrics: (rows) => {
        for (const row of rows) {
          run.sampleBuffer.push({
            serviceId: row.serviceId,
            virtualTimeUs: row.virtualTimeUs,
            wallTimeMs: Date.now(),
            requestsCompleted: row.requestsTotal - row.requestsFailed,
            requestsFailed: row.requestsFailed,
            latencySamplesUs: Array.from(row.latencySamplesUs),
            queueDepth: row.queueDepth,
            activeSlots: row.activeSlots,
            circuitState: 'CLOSED',
          });
        }
      },
    }).then((result) => {
      run.lastResult = result;
      return result;
    });
  }

  async *observe(handle: RuntimeHandle): AsyncIterable<RuntimeSample> {
    const run = this.runs.get(handle.id);
    if (!run) {
      throw new Error(`Run not found: ${handle.id}`);
    }

    let readIndex = 0;
    while (!run.lastResult || readIndex < run.sampleBuffer.length) {
      if (readIndex < run.sampleBuffer.length) {
        yield run.sampleBuffer[readIndex++];
      } else {
        await new Promise((r) => setTimeout(r, 100));
      }
    }
  }

  async health(handle: RuntimeHandle): Promise<ServiceHealth[]> {
    const run = this.runs.get(handle.id);
    if (!run) {
      throw new Error(`Run not found: ${handle.id}`);
    }

    return run.spec.services.map((s) => ({
      serviceId: s.id,
      status: 'HEALTHY',
      instanceStatuses: [{ index: 0, status: 'HEALTHY' }],
    }));
  }

  async teardown(handle: RuntimeHandle): Promise<void> {
    const run = this.runs.get(handle.id);
    if (run) {
      run.engine.stop();
      this.runs.delete(handle.id);
    }
  }

  getProvisionedRun(runId: string): ProvisionedRun | undefined {
    return this.runs.get(runId);
  }
}
