import { AppError } from '@mirrorgrid/platform';
import {
  ExperimentOrchestrator,
  ExperimentFreezer,
  type FrozenExperimentConfig,
  type ExperimentRunSummary,
  type DetectorSpec,
} from '@mirrorgrid/experiments';
import { db, schema } from '@mirrorgrid/db';
import { eq } from 'drizzle-orm';
import { ExperimentRepository } from './experiment.repository.js';
import type { CreateExperimentDto, StartExperimentDto } from './experiment.schema.js';

export class ExperimentService {
  private readonly repo: ExperimentRepository;
  private readonly activeOrchestrators = new Map<string, ExperimentOrchestrator>();

  constructor(repo?: ExperimentRepository) {
    this.repo = repo ?? new ExperimentRepository();
  }

  public async create(worldId: string, dto: CreateExperimentDto) {
    return this.repo.createExperiment(worldId, dto);
  }

  public async list(worldId: string) {
    return this.repo.getExperimentsByWorld(worldId);
  }

  public async get(id: string) {
    const exp = await this.repo.getExperimentById(id);
    if (!exp) throw AppError.notFound(`Experiment not found: ${id}`);
    const detectors = await this.repo.getDetectorsByExperiment(id);
    const latestRun = await this.repo.getLatestRun(id);
    return { ...exp, detectors, latestRun };
  }

  public async start(
    worldId: string,
    experimentId: string,
    dto: StartExperimentDto,
  ): Promise<{ runId: string; status: string; runNumber: number }> {
    const exp = await this.repo.getExperimentById(experimentId);
    if (!exp) throw AppError.notFound(`Experiment not found: ${experimentId}`);

    // Load services and dependencies for world
    const services = await db
      .select()
      .from(schema.services)
      .where(eq(schema.services.worldId, worldId));

    const dependencies = await db
      .select()
      .from(schema.serviceDependencies)
      .where(eq(schema.serviceDependencies.worldId, worldId));

    const detectors = await this.repo.getDetectorsByExperiment(experimentId);

    const latestRun = await this.repo.getLatestRun(experimentId);
    const nextRunNumber = (latestRun?.runNumber ?? 0) + 1;

    const seed = dto.seed ?? '42';

    const frozenConfig: FrozenExperimentConfig = ExperimentFreezer.freeze({
      experimentId,
      worldId,
      name: exp.name,
      hypothesis: exp.hypothesis,
      version: exp.version,
      seed,
      engineVersion: '0.1.0',
      topology: {
        services: services.map((s) => ({
          id: s.id,
          name: s.name,
          concurrencyLimit: s.concurrencyLimit,
          queueCapacity: s.queueCapacity,
        })),
        edges: dependencies.map((d) => ({
          id: d.id,
          sourceId: d.sourceServiceId,
          targetId: d.targetServiceId,
          timeoutMs: d.timeoutMs,
          retryPolicy: d.retryPolicy as unknown as Record<string, unknown>,
          circuitBreakerPolicy: d.circuitBreakerPolicy as unknown as Record<string, unknown>,
        })),
      },
      workload: {
        pattern: 'CONSTANT',
        baseRate: 200,
        peakRate: 200,
        durationMicros:
          exp.baselineDurationMicros + exp.faultDurationMicros + exp.cooldownDurationMicros,
      },
      faults: [],
      detectors: detectors.map((d) => ({
        id: d.id,
        name: d.name,
        type: d.detectorType as DetectorSpec['type'],
        targetServiceId: d.targetServiceId ?? undefined,
        targetEdgeId: d.targetEdgeId ?? undefined,
        threshold: Number(d.thresholdValue),
        windowMicros: d.windowDurationMicros,
      })),
      schedule: {
        baselineMicros: exp.baselineDurationMicros,
        faultMicros: exp.faultDurationMicros,
        cooldownMicros: exp.cooldownDurationMicros,
      },
    });

    const runId = crypto.randomUUID();
    const configHash = ExperimentFreezer.computeHash(frozenConfig);

    await this.repo.createRun({
      id: runId,
      experimentId,
      worldId,
      runNumber: nextRunNumber,
      runtimeMode: dto.runtimeMode,
      seed: BigInt(seed),
      engineVersion: '0.1.0',
      configHash,
      frozenConfig: frozenConfig as unknown as Record<string, unknown>,
    });

    await this.repo.updateExperimentStatus(
      experimentId,
      'RUNNING',
      frozenConfig as unknown as Record<string, unknown>,
    );

    const orchestrator = new ExperimentOrchestrator({
      config: frozenConfig,
      runId,
      runNumber: nextRunNumber,
      runtimeMode: dto.runtimeMode,
    });

    this.activeOrchestrators.set(experimentId, orchestrator);

    // Execute in background
    orchestrator
      .execute('FAST')
      .then(async (summary: ExperimentRunSummary) => {
        await this.repo.updateRunCompletion(runId, {
          status: summary.status === 'COMPLETED' ? 'COMPLETED' : 'CANCELLED',
          currentPhase: summary.status,
          stateHash: summary.stateHash,
          mttdMicros: summary.mttdMicros,
          mttrMicros: summary.mttrMicros,
          peakErrorRatePpm: Math.floor(summary.peakErrorRatePercent * 10_000),
          peakP99Micros: summary.peakP99Us,
          resultSummary: {
            retryAmplificationFactor: summary.retryAmplificationFactor,
            totalInitialRequests: summary.totalInitialRequests,
            totalRetriedRequests: summary.totalRetriedRequests,
            peakErrorRatePercent: summary.peakErrorRatePercent,
          },
        });

        await this.repo.recordTimelineEvents(summary.timeline);
        await this.repo.updateExperimentStatus(experimentId, 'COMPLETED');
        this.activeOrchestrators.delete(experimentId);
      })
      .catch(async (err: unknown) => {
        const errorMsg = err instanceof Error ? err.message : String(err);
        console.error('Experiment run execution failed:', errorMsg);
        await this.repo.updateRunCompletion(runId, {
          status: 'FAILED',
          currentPhase: 'FAILED',
          stateHash: '',
          mttdMicros: null,
          mttrMicros: null,
          peakErrorRatePpm: 0,
          peakP99Micros: 0n,
          resultSummary: { error: errorMsg },
        });
        await this.repo.updateExperimentStatus(experimentId, 'ABORTED');
        this.activeOrchestrators.delete(experimentId);
      });

    return {
      runId,
      status: 'RUNNING',
      runNumber: nextRunNumber,
    };
  }

  public async abort(experimentId: string, reason: string) {
    const orchestrator = this.activeOrchestrators.get(experimentId);
    if (orchestrator) {
      orchestrator.abort(reason);
      this.activeOrchestrators.delete(experimentId);
    }
    await this.repo.updateExperimentStatus(experimentId, 'ABORTED');
    return { status: 'ABORTED', reason };
  }

  public async getStatus(experimentId: string) {
    const orchestrator = this.activeOrchestrators.get(experimentId);
    const latestRun = await this.repo.getLatestRun(experimentId);
    return {
      experimentId,
      phase: orchestrator ? orchestrator.getPhase() : (latestRun?.currentPhase ?? 'UNKNOWN'),
      isRunning: !!orchestrator,
      latestRun,
    };
  }

  public async getReport(experimentId: string, runNumber: number) {
    const run = await this.repo.getRunByNumber(experimentId, runNumber);
    if (!run) throw AppError.notFound(`Run #${runNumber} not found for experiment ${experimentId}`);
    const timeline = await this.repo.getTimelineEvents(run.id);
    return {
      run,
      timeline,
    };
  }
}
