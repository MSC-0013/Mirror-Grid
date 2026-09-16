import { eq, and } from 'drizzle-orm';
import { db, schema } from '@mirrorgrid/db';

export class BreakerRepository {
  public async findByWorldId(worldId: string) {
    return db
      .select({
        id: schema.circuitBreakerStates.id,
        worldId: schema.circuitBreakerStates.worldId,
        serviceId: schema.circuitBreakerStates.serviceId,
        edgeId: schema.circuitBreakerStates.edgeId,
        currentState: schema.circuitBreakerStates.currentState,
        stateEnteredAtMicros: schema.circuitBreakerStates.stateEnteredAtMicros,
        failureRatePpm: schema.circuitBreakerStates.failureRatePpm,
        consecutiveFailures: schema.circuitBreakerStates.consecutiveFailures,
        consecutiveSuccesses: schema.circuitBreakerStates.consecutiveSuccesses,
        totalRequests: schema.circuitBreakerStates.totalRequests,
        totalRejections: schema.circuitBreakerStates.totalRejections,
        updatedAt: schema.circuitBreakerStates.updatedAt,
      })
      .from(schema.circuitBreakerStates)
      .where(eq(schema.circuitBreakerStates.worldId, worldId));
  }

  public async findById(worldId: string, id: string) {
    const [row] = await db
      .select()
      .from(schema.circuitBreakerStates)
      .where(
        and(
          eq(schema.circuitBreakerStates.worldId, worldId),
          eq(schema.circuitBreakerStates.id, id),
        ),
      );
    return row || null;
  }

  public async upsertBreakerState(
    worldId: string,
    serviceId: string,
    edgeId: string | null,
    currentState: string,
    failureRatePpm: number,
    nowMicros: bigint,
  ) {
    const [row] = await db
      .insert(schema.circuitBreakerStates)
      .values({
        worldId,
        serviceId,
        edgeId: edgeId ?? undefined,
        currentState,
        failureRatePpm,
        stateEnteredAtMicros: nowMicros,
      })
      .onConflictDoUpdate({
        target: [
          schema.circuitBreakerStates.worldId,
          schema.circuitBreakerStates.serviceId,
          schema.circuitBreakerStates.edgeId,
        ],
        set: {
          currentState,
          failureRatePpm,
          stateEnteredAtMicros: nowMicros,
          updatedAt: new Date(),
        },
      })
      .returning();
    return row;
  }

  public async updateState(id: string, toState: string, nowMicros: bigint, failureRatePpm: number) {
    const [row] = await db
      .update(schema.circuitBreakerStates)
      .set({
        currentState: toState,
        stateEnteredAtMicros: nowMicros,
        failureRatePpm,
        updatedAt: new Date(),
      })
      .where(eq(schema.circuitBreakerStates.id, id))
      .returning();
    return row;
  }

  public async recordTransition(
    worldId: string,
    serviceId: string,
    edgeId: string | null,
    fromState: string,
    toState: string,
    reason: string,
    nowMicros: bigint,
    failureRatePpm: number,
  ) {
    const [row] = await db
      .insert(schema.circuitBreakerTransitions)
      .values({
        worldId,
        serviceId,
        edgeId: edgeId ?? undefined,
        fromState,
        toState,
        transitionReason: reason,
        eventMicros: nowMicros,
        failureRatePpm,
      })
      .returning();
    return row;
  }

  public async findTransitions(worldId: string, limit = 50) {
    return db
      .select()
      .from(schema.circuitBreakerTransitions)
      .where(eq(schema.circuitBreakerTransitions.worldId, worldId))
      .orderBy(schema.circuitBreakerTransitions.eventMicros)
      .limit(limit);
  }
}
