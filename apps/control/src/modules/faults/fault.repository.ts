import { eq, and, inArray } from 'drizzle-orm';
import { db, schema, insertReturning, updateReturning } from '@mirrorgrid/db';
import type { CreateFaultSpecInput } from './fault.schema.js';

export class FaultRepository {
  public async createSpec(worldId: string, input: CreateFaultSpecInput) {
    return insertReturning(schema.faultSpecifications, {
      worldId,
      name: input.name,
      description: input.description,
      faultType: input.faultType,
      targetServiceId: input.targetServiceId,
      targetEdgeId: input.targetEdgeId,
      parameters: input.parameters,
      safetyRules: input.safetyRules,
    });
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
    return insertReturning(schema.experimentFaults, {
      worldId,
      faultSpecId,
      status: 'ACTIVE',
      scheduledStartMicros: startMicros,
      scheduledDurationMicros: durationMicros,
      actualStartMicros: startMicros,
      appliedParameters,
    });
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
    return updateReturning(
      schema.experimentFaults,
      { status, actualEndMicros: endMicros, abortReason, updatedAt: new Date() },
      eq(schema.experimentFaults.id, executionId),
    );
  }

  /**
   * Aborts every active fault for a world and returns all of them — a bulk operation,
   * so the single-row updateReturning() helper does not fit. The set of affected ids is
   * captured BEFORE the update (from the same WHERE that guards the update itself), so
   * the post-update read reflects exactly the rows this call changed, not a broader
   * `status = 'ABORTED'` scan that could also pick up unrelated prior aborts.
   */
  public async abortAllActiveExecutions(worldId: string, endMicros: bigint, reason: string) {
    const activeCondition = and(
      eq(schema.experimentFaults.worldId, worldId),
      eq(schema.experimentFaults.status, 'ACTIVE'),
    );

    const targets = await db
      .select({ id: schema.experimentFaults.id })
      .from(schema.experimentFaults)
      .where(activeCondition);

    if (targets.length === 0) return [];
    const ids = targets.map((t) => t.id);

    await db
      .update(schema.experimentFaults)
      .set({
        status: 'ABORTED',
        actualEndMicros: endMicros,
        abortReason: reason,
        updatedAt: new Date(),
      })
      .where(and(activeCondition, inArray(schema.experimentFaults.id, ids)));

    return db
      .select()
      .from(schema.experimentFaults)
      .where(inArray(schema.experimentFaults.id, ids));
  }
}
