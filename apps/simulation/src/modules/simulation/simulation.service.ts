import crypto from 'node:crypto';
import { AppError } from '@mirrorgrid/platform';
import { ENGINE_VERSION, type EngineWorldSpec, type EngineServiceSpec } from '@mirrorgrid/sim';
import type { EdgeSpec } from '@mirrorgrid/sim/queueing';
import type { WorkloadSpec } from '@mirrorgrid/sim/workload';
import { simulationRepository, SimulationRepository } from './simulation.repository.js';
import { enginePool, EnginePool } from '../../engine/engine-pool.js';
import type { CreateRunInput } from './simulation.schema.js';

function computeQuantile(samples: number[], q: number): number {
  if (samples.length === 0) return 0;
  const sorted = [...samples].sort((a, b) => a - b);
  const idx = Math.min(Math.floor(sorted.length * q), sorted.length - 1);
  return sorted[idx];
}

export class SimulationService {
  constructor(
    private readonly repo: SimulationRepository = simulationRepository,
    private readonly pool: EnginePool = enginePool
  ) {}

  async createRun(input: CreateRunInput) {
    const worldData = await this.repo.getWorldWithTopology(input.worldId);
    if (!worldData) {
      throw AppError.notFound(`World ${input.worldId} not found`);
    }

    if (worldData.services.length === 0) {
      throw AppError.badRequest('Cannot run simulation on a world with no services');
    }

    const targetServiceIds = new Set(worldData.dependencies.map((d) => d.targetServiceId));
    const entryService = worldData.services.find((s) => !targetServiceIds.has(s.id)) ?? worldData.services[0];

    const engineServices: EngineServiceSpec[] = worldData.services.map((s) => {
      const cfg = s.config as Record<string, unknown> | null;
      return {
        id: s.id,
        name: s.name,
        concurrencyLimit: s.concurrencyLimit,
        queueCapacity: s.queueCapacity,
        serviceTimeTable: typeof cfg?.serviceTimeTable === 'string' ? cfg.serviceTimeTable : 'default_service',
      };
    });

    const engineEdges: EdgeSpec[] = worldData.dependencies.map((d) => ({
      sourceId: d.sourceServiceId,
      targetId: d.targetServiceId,
      timeoutMs: d.timeoutMs,
    }));

    const durationUs = BigInt(input.durationMs) * 1000n;

    const frozenConfig = {
      worldId: input.worldId,
      services: engineServices,
      edges: engineEdges,
      entryServiceId: entryService.id,
      requestTimeoutMs: 5000,
      workload: {
        pattern: input.pattern,
        baseRatePerSecond: input.baseRate,
        durationUs: durationUs.toString(),
      },
    };

    const configJson = JSON.stringify(frozenConfig);
    const configHash = crypto.createHash('sha256').update(configJson).digest('hex');

    const createdRun = await this.repo.createRun({
      worldId: input.worldId,
      seed: input.seed,
      runtimeMode: input.runtimeMode,
      engineVersion: ENGINE_VERSION,
      schemaVersion: 1,
      frozenConfig,
      configHash,
      status: 'CREATED',
    });

    const engineSpec: EngineWorldSpec = {
      worldId: input.worldId,
      services: engineServices,
      edges: engineEdges,
      entryServiceId: entryService.id,
      requestTimeoutMs: 5000,
    };

    const workload: WorkloadSpec = {
      pattern: input.pattern,
      baseRatePerSecond: input.baseRate,
      durationUs,
    };

    this.pool.registerRun(createdRun.id, input.worldId, input.seed, engineSpec, workload, input.driver);

    return {
      runId: createdRun.id,
      worldId: createdRun.worldId,
      status: createdRun.status,
      seed: createdRun.seed.toString(),
      engineVersion: createdRun.engineVersion,
      configHash: createdRun.configHash,
    };
  }

  async startRun(runId: string) {
    const run = await this.repo.getRunById(runId);
    if (!run) {
      throw AppError.notFound(`Run ${runId} not found`);
    }

    if (run.status === 'RUNNING') {
      return { runId, status: 'RUNNING' };
    }

    if (run.status === 'COMPLETED' || run.status === 'CANCELLED') {
      throw AppError.badRequest(`Run ${runId} is already in terminal state ${run.status}`);
    }

    // Ensure run is in pool; if not, rebuild from frozen config
    let activeRun = this.pool.getRun(runId);
    if (!activeRun) {
      const cfg = run.frozenConfig as {
        services: EngineServiceSpec[];
        edges: EdgeSpec[];
        entryServiceId: string;
        requestTimeoutMs?: number;
        workload: {
          pattern: any;
          baseRatePerSecond: number;
          durationUs: string;
        };
      };

      const engineSpec: EngineWorldSpec = {
        worldId: run.worldId,
        services: cfg.services,
        edges: cfg.edges,
        entryServiceId: cfg.entryServiceId,
        requestTimeoutMs: cfg.requestTimeoutMs ?? 5000,
      };

      const workload: WorkloadSpec = {
        pattern: cfg.workload.pattern,
        baseRatePerSecond: cfg.workload.baseRatePerSecond,
        durationUs: BigInt(cfg.workload.durationUs),
      };

      activeRun = this.pool.registerRun(
        runId,
        run.worldId,
        run.seed,
        engineSpec,
        workload,
        'FAST'
      );
    }

    // Launch execution asynchronously
    void this.pool.startRun(runId);

    return { runId, status: 'RUNNING' };
  }

  async stopRun(runId: string) {
    const run = await this.repo.getRunById(runId);
    if (!run) {
      throw AppError.notFound(`Run ${runId} not found`);
    }

    await this.pool.stopRun(runId);
    return { runId, status: 'CANCELLED' };
  }

  async getRunStatus(runId: string) {
    const run = await this.repo.getRunById(runId);
    if (!run) {
      throw AppError.notFound(`Run ${runId} not found`);
    }

    const activeRun = this.pool.getRun(runId);

    return {
      runId: run.id,
      worldId: run.worldId,
      status: activeRun ? activeRun.status : run.status,
      seed: run.seed.toString(),
      engineVersion: run.engineVersion,
      configHash: run.configHash,
      finalStateHash: run.finalStateHash ?? activeRun?.lastResult?.stateHash.root,
      startedAt: run.startedAt,
      completedAt: run.completedAt,
    };
  }

  async getMetrics(runId: string, serviceId?: string, fromUs?: bigint, toUs?: bigint) {
    const run = await this.repo.getRunById(runId);
    if (!run) {
      throw AppError.notFound(`Run ${runId} not found`);
    }

    // Retrieve metrics from DB
    const dbMetrics = await this.repo.getMetrics(runId, serviceId, fromUs, toUs);

    const buckets = dbMetrics.map((m) => {
      const rawSamples = m.latencySamplesUs ?? [];
      return {
        id: m.id.toString(),
        serviceId: m.serviceId,
        virtualTimeUs: m.virtualTimeUs.toString(),
        requestsTotal: m.requestsTotal,
        requestsFailed: m.requestsFailed,
        queueDepth: m.queueDepth,
        activeSlots: m.activeSlots,
        circuitState: m.circuitState ?? 'CLOSED',
        p50LatencyUs: computeQuantile(rawSamples, 0.5),
        p95LatencyUs: computeQuantile(rawSamples, 0.95),
        p99LatencyUs: computeQuantile(rawSamples, 0.99),
        quantileQuality: 'EXACT' as const,
      };
    });

    return {
      runId,
      quantileQuality: 'EXACT',
      count: buckets.length,
      buckets,
    };
  }
}

export const simulationService = new SimulationService();
