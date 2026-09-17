import { eq, desc, and } from 'drizzle-orm';
import { db, schema, insertReturning, updateReturning } from '@mirrorgrid/db';
import type { CreateExperimentDto } from './experiment.schema.js';

export class ExperimentRepository {
  public async createExperiment(worldId: string, dto: CreateExperimentDto) {
    const row = await insertReturning(schema.experiments, {
      worldId,
      name: dto.name,
      hypothesis: dto.hypothesis,
      status: 'DRAFT',
      version: 1,
      baselineDurationMicros: BigInt(dto.baselineDurationMicros),
      faultDurationMicros: BigInt(dto.faultDurationMicros),
      cooldownDurationMicros: BigInt(dto.cooldownDurationMicros),
    });

    if (dto.detectors.length > 0) {
      await db.insert(schema.experimentDetectors).values(
        dto.detectors.map((d) => ({
          experimentId: row.id,
          name: d.name,
          detectorType: d.detectorType,
          targetServiceId: d.targetServiceId,
          targetEdgeId: d.targetEdgeId,
          thresholdValue: d.thresholdValue.toString(),
          windowDurationMicros: BigInt(d.windowDurationMicros),
        })),
      );
    }

    return row;
  }

  public async getExperimentsByWorld(worldId: string) {
    return db
      .select()
      .from(schema.experiments)
      .where(eq(schema.experiments.worldId, worldId))
      .orderBy(desc(schema.experiments.createdAt));
  }

  public async getExperimentById(id: string) {
    const [row] = await db
      .select()
      .from(schema.experiments)
      .where(eq(schema.experiments.id, id))
      .limit(1);
    return row || null;
  }

  public async getDetectorsByExperiment(experimentId: string) {
    return db
      .select()
      .from(schema.experimentDetectors)
      .where(eq(schema.experimentDetectors.experimentId, experimentId));
  }

  public async updateExperimentStatus(
    id: string,
    status: string,
    frozenConfig?: Record<string, unknown>,
  ) {
    return updateReturning(
      schema.experiments,
      { status, ...(frozenConfig ? { frozenConfig } : {}), updatedAt: new Date() },
      eq(schema.experiments.id, id),
    );
  }

  public async createRun(data: {
    id: string;
    experimentId: string;
    worldId: string;
    runNumber: number;
    runtimeMode: 'LOGICAL' | 'CONTAINER' | 'HYBRID';
    seed: bigint;
    engineVersion: string;
    configHash: string;
    frozenConfig: Record<string, unknown>;
  }) {
    return insertReturning(schema.experimentRuns, {
      id: data.id,
      experimentId: data.experimentId,
      worldId: data.worldId,
      runNumber: data.runNumber,
      runtimeMode: data.runtimeMode,
      seed: data.seed,
      engineVersion: data.engineVersion,
      configHash: data.configHash,
      frozenConfig: data.frozenConfig,
      status: 'RUNNING',
      currentPhase: 'WARMUP',
      startedAt: new Date(),
    });
  }

  public async updateRunCompletion(
    runId: string,
    data: {
      status: 'COMPLETED' | 'CANCELLED' | 'FAILED';
      currentPhase: string;
      stateHash: string;
      mttdMicros: bigint | null;
      mttrMicros: bigint | null;
      peakErrorRatePpm: number;
      peakP99Micros: bigint;
      resultSummary: Record<string, unknown>;
    },
  ) {
    return updateReturning(
      schema.experimentRuns,
      {
        status: data.status,
        currentPhase: data.currentPhase,
        finalStateHash: data.stateHash,
        mttdMicros: data.mttdMicros,
        mttrMicros: data.mttrMicros,
        peakErrorRatePpm: data.peakErrorRatePpm,
        peakP99Micros: data.peakP99Micros,
        resultSummary: data.resultSummary,
        completedAt: new Date(),
      },
      eq(schema.experimentRuns.id, runId),
    );
  }

  public async getLatestRun(experimentId: string) {
    const [row] = await db
      .select()
      .from(schema.experimentRuns)
      .where(eq(schema.experimentRuns.experimentId, experimentId))
      .orderBy(desc(schema.experimentRuns.runNumber))
      .limit(1);
    return row || null;
  }

  public async getRunByNumber(experimentId: string, runNumber: number) {
    const [row] = await db
      .select()
      .from(schema.experimentRuns)
      .where(
        and(
          eq(schema.experimentRuns.experimentId, experimentId),
          eq(schema.experimentRuns.runNumber, runNumber),
        ),
      )
      .limit(1);
    return row || null;
  }

  public async recordTimelineEvents(
    events: readonly {
      runId: string;
      simTimeMicros: bigint;
      eventCategory: string;
      summary: string;
      details: Record<string, unknown>;
    }[],
  ) {
    if (events.length === 0) return;
    await db.insert(schema.experimentEvents).values(
      events.map((e) => ({
        runId: e.runId,
        simTimeMicros: e.simTimeMicros,
        eventCategory: e.eventCategory,
        summary: e.summary,
        details: e.details,
      })),
    );
  }

  public async getTimelineEvents(runId: string) {
    return db
      .select()
      .from(schema.experimentEvents)
      .where(eq(schema.experimentEvents.runId, runId))
      .orderBy(schema.experimentEvents.simTimeMicros);
  }
}
