import { eq, and } from 'drizzle-orm';
import { db, schema } from '@mirrorgrid/db';
import type { CreateFaultSpecInput } from './fault.schema.js';

export class FaultRepository {
  public async createSpec(worldId: string, input: CreateFaultSpecInput) {
    const [row] = await db
      .insert(schema.faultSpecifications)
      .values({
        worldId,
        name: input.name,
        description: input.description,
        faultType: input.faultType,
        targetServiceId: input.targetServiceId,
        targetEdgeId: input.targetEdgeId,
        parameters: input.parameters,
        safetyRules: input.safetyRules,
      })
      .returning();
    return row;
  }

  public async findSpecsByWorldId(worldId: string) {
    return db
      .select()
      .from(schema.faultSpecifications)
      .where(eq(schema.faultSpecifications.worldId, worldId));
  }

  public async findSpecById(worldId: string, id: string) {
    const [row] = await db
      .select()
      .from(schema.faultSpecifications)
      .where(
        and(eq(schema.faultSpecifications.worldId, worldId), eq(schema.faultSpecifications.id, id)),
      );
    return row || null;
  }

  public async createExecution(
    worldId: string,
    faultSpecId: string,
    startMicros: bigint,
    durationMicros: bigint,
    appliedParameters: Record<string, unknown>,
  ) {
    const [row] = await db
      .insert(schema.experimentFaults)
      .values({
        worldId,
        faultSpecId,
        status: 'ACTIVE',
        scheduledStartMicros: startMicros,
        scheduledDurationMicros: durationMicros,
        actualStartMicros: startMicros,
        appliedParameters,
      })
      .returning();
    return row;
  }

  public async findActiveExecutions(worldId: string) {
    return db
      .select()
      .from(schema.experimentFaults)
      .where(
        and(
          eq(schema.experimentFaults.worldId, worldId),
          eq(schema.experimentFaults.status, 'ACTIVE'),
        ),
      );
  }

  public async updateExecutionStatus(
    executionId: string,
    status: 'COMPLETED' | 'ABORTED',
    endMicros: bigint,
    abortReason?: string,
  ) {
    const [row] = await db
      .update(schema.experimentFaults)
      .set({
        status,
        actualEndMicros: endMicros,
        abortReason,
        updatedAt: new Date(),
      })
      .where(eq(schema.experimentFaults.id, executionId))
      .returning();
    return row;
  }

  public async abortAllActiveExecutions(worldId: string, endMicros: bigint, reason: string) {
    return db
      .update(schema.experimentFaults)
      .set({
        status: 'ABORTED',
        actualEndMicros: endMicros,
        abortReason: reason,
        updatedAt: new Date(),
      })
      .where(
        and(
          eq(schema.experimentFaults.worldId, worldId),
          eq(schema.experimentFaults.status, 'ACTIVE'),
        ),
      )
      .returning();
  }
}
