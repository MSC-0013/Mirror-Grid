import { db } from '@mirrorgrid/db';
import {
  experimentRuns,
  experimentMetrics,
  worlds,
  services,
  serviceDependencies,
  type ExperimentRun,
  type ExperimentMetric,
} from '@mirrorgrid/db/schema';
import { eq, and, gte, lte } from 'drizzle-orm';

export class SimulationRepository {
  async getRunById(id: string): Promise<ExperimentRun | undefined> {
    const rows = await db.select().from(experimentRuns).where(eq(experimentRuns.id, id)).limit(1);
    return rows[0];
  }

  async getWorldWithTopology(worldId: string) {
    const worldRows = await db.select().from(worlds).where(eq(worlds.id, worldId)).limit(1);
    if (!worldRows[0]) return undefined;

    const serviceRows = await db.select().from(services).where(eq(services.worldId, worldId));
    const dependencyRows = await db
      .select()
      .from(serviceDependencies)
      .where(eq(serviceDependencies.worldId, worldId));

    return {
      world: worldRows[0],
      services: serviceRows,
      dependencies: dependencyRows,
    };
  }

  async createRun(run: typeof experimentRuns.$inferInsert): Promise<ExperimentRun> {
    const rows = await db.insert(experimentRuns).values(run).returning();
    return rows[0];
  }

  async updateRunStatus(
    id: string,
    status: 'CREATED' | 'RUNNING' | 'COMPLETED' | 'FAILED' | 'CANCELLED',
    finalStateHash?: string,
  ) {
    const values: Record<string, unknown> = { status };
    if (finalStateHash) values.finalStateHash = finalStateHash;
    if (status === 'RUNNING') values.startedAt = new Date();
    if (status === 'COMPLETED' || status === 'FAILED' || status === 'CANCELLED')
      values.completedAt = new Date();

    const rows = await db
      .update(experimentRuns)
      .set(values)
      .where(eq(experimentRuns.id, id))
      .returning();
    return rows[0];
  }

  async getMetrics(
    runId: string,
    serviceId?: string,
    fromUs?: bigint,
    toUs?: bigint,
  ): Promise<ExperimentMetric[]> {
    const conditions = [eq(experimentMetrics.runId, runId)];

    if (serviceId) {
      conditions.push(eq(experimentMetrics.serviceId, serviceId));
    }
    if (fromUs !== undefined) {
      conditions.push(gte(experimentMetrics.virtualTimeUs, fromUs));
    }
    if (toUs !== undefined) {
      conditions.push(lte(experimentMetrics.virtualTimeUs, toUs));
    }

    return db
      .select()
      .from(experimentMetrics)
      .where(and(...conditions))
      .orderBy(experimentMetrics.virtualTimeUs);
  }
}

export const simulationRepository = new SimulationRepository();
