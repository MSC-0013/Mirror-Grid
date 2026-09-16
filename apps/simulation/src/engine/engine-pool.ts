import { db } from '@mirrorgrid/db';
import { experimentRuns, experimentMetrics } from '@mirrorgrid/db/schema';
import { eq } from 'drizzle-orm';
import {
  SimEngine,
  type EngineWorldSpec,
  type EngineRunResult,
} from '@mirrorgrid/sim';
import type { WorkloadSpec } from '@mirrorgrid/sim/workload';
import { FastDriver, RealtimeDriver, type ClockDriver } from '@mirrorgrid/sim/clock';
import type { MetricSampleRow } from '@mirrorgrid/sim/metrics';
import { createLogger } from '@mirrorgrid/logging';

const logger = createLogger({ name: 'engine-pool' });

export interface ActiveRun {
  runId: string;
  worldId: string;
  seed: bigint;
  driverType: 'FAST' | 'REALTIME';
  engine: SimEngine;
  workload: WorkloadSpec;
  status: 'CREATED' | 'RUNNING' | 'COMPLETED' | 'FAILED' | 'CANCELLED';
  startedAt?: Date;
  completedAt?: Date;
  runPromise?: Promise<EngineRunResult>;
  lastResult?: EngineRunResult;
  metricRows: MetricSampleRow[];
}

export class EnginePool {
  private readonly runs = new Map<string, ActiveRun>();

  registerRun(
    runId: string,
    worldId: string,
    seed: bigint,
    spec: EngineWorldSpec,
    workload: WorkloadSpec,
    driverType: 'FAST' | 'REALTIME' = 'FAST'
  ): ActiveRun {
    const engine = new SimEngine(spec);
    const activeRun: ActiveRun = {
      runId,
      worldId,
      seed,
      driverType,
      engine,
      workload,
      status: 'CREATED',
      metricRows: [],
    };

    this.runs.set(runId, activeRun);
    return activeRun;
  }

  getRun(runId: string): ActiveRun | undefined {
    return this.runs.get(runId);
  }

  async startRun(runId: string): Promise<void> {
    const run = this.runs.get(runId);
    if (!run) {
      throw new Error(`Run ${runId} not found in pool`);
    }

    if (run.status === 'RUNNING') {
      return;
    }

    run.status = 'RUNNING';
    run.startedAt = new Date();

    // Update DB status
    await db
      .update(experimentRuns)
      .set({ status: 'RUNNING', startedAt: run.startedAt })
      .where(eq(experimentRuns.id, runId));

    const driver: ClockDriver = run.driverType === 'REALTIME' ? new RealtimeDriver() : new FastDriver();

    run.runPromise = run.engine
      .run({
        seed: run.seed,
        workload: run.workload,
        driver,
        retainSamples: true,
        onMetrics: (flushedRows) => {
          run.metricRows.push(...flushedRows);
          void this.persistMetrics(run.runId, flushedRows);
        },
      })
      .then(async (result) => {
        run.status = 'COMPLETED';
        run.completedAt = new Date();
        run.lastResult = result;

        // Persist completion and final state hash
        await db
          .update(experimentRuns)
          .set({
            status: 'COMPLETED',
            completedAt: run.completedAt,
            finalStateHash: result.stateHash.root,
          })
          .where(eq(experimentRuns.id, run.runId));

        logger.info(
          { runId: run.runId, rootHash: result.stateHash.root, totals: result.totals },
          'Simulation run completed'
        );

        return result;
      })
      .catch(async (err) => {
        run.status = 'FAILED';
        run.completedAt = new Date();
        await db
          .update(experimentRuns)
          .set({ status: 'FAILED', completedAt: run.completedAt })
          .where(eq(experimentRuns.id, run.runId));

        logger.error({ runId: run.runId, err }, 'Simulation run failed');
        throw err;
      });
  }

  async stopRun(runId: string): Promise<void> {
    const run = this.runs.get(runId);
    if (!run) {
      return;
    }

    run.engine.stop();
    run.status = 'CANCELLED';
    run.completedAt = new Date();

    await db
      .update(experimentRuns)
      .set({ status: 'CANCELLED', completedAt: run.completedAt })
      .where(eq(experimentRuns.id, runId));
  }

  private async persistMetrics(runId: string, rows: readonly MetricSampleRow[]): Promise<void> {
    if (rows.length === 0) return;

    try {
      const dbValues = rows.map((r) => ({
        runId,
        serviceId: r.serviceId,
        virtualTimeUs: r.virtualTimeUs,
        wallTimeMs: BigInt(Date.now()),
        requestsTotal: r.requestsTotal,
        requestsFailed: r.requestsFailed,
        queueDepth: r.queueDepth,
        activeSlots: r.activeSlots,
        circuitState: 'CLOSED' as const,
        latencySamplesUs: r.latencySamplesUs.length > 0 ? Array.from(r.latencySamplesUs) : null,
        latencyHistogram: r.latencyHistogram ? Array.from(r.latencyHistogram) : null,
      }));

      await db.insert(experimentMetrics).values(dbValues);
    } catch (err) {
      logger.error({ err, runId, count: rows.length }, 'Failed to persist simulation metrics to DB');
    }
  }

  cleanup(runId: string): void {
    const run = this.runs.get(runId);
    if (run) {
      run.engine.stop();
      this.runs.delete(runId);
    }
  }
}

export const enginePool = new EnginePool();
