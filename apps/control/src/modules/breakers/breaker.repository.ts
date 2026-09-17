import { eq, and, isNull } from 'drizzle-orm';
import { db, schema, insertReturning, updateReturning } from '@mirrorgrid/db';

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
    // Same upsert-and-read-back shape as runtime.repository.ts's container upsert.
    // Re-selecting on edgeId needs isNull() rather than eq(col, null): eq() emits
    // `edge_id = NULL`, which SQL evaluates as unknown (never true) rather than as a
    // match — a bare `=` against NULL would make this read-back silently return nothing
    // for the world-level (no specific edge) breaker case.
    await db
      .insert(schema.circuitBreakerStates)
      .values({
        worldId,
        serviceId,
        edgeId: edgeId ?? undefined,
        currentState,
        failureRatePpm,
        stateEnteredAtMicros: nowMicros,
      })
      .onDuplicateKeyUpdate({
        set: {
          currentState,
          failureRatePpm,
          stateEnteredAtMicros: nowMicros,
          updatedAt: new Date(),
        },
      });

    const [row] = await db
      .select()
      .from(schema.circuitBreakerStates)
      .where(
        and(
          eq(schema.circuitBreakerStates.worldId, worldId),
          eq(schema.circuitBreakerStates.serviceId, serviceId),
          edgeId ? eq(schema.circuitBreakerStates.edgeId, edgeId) : isNull(schema.circuitBreakerStates.edgeId),
        ),
      )
      .limit(1);
    return row;
  }

  public async updateState(id: string, toState: string, nowMicros: bigint, failureRatePpm: number) {
    return updateReturning(
      schema.circuitBreakerStates,
      {
        currentState: toState,
        stateEnteredAtMicros: nowMicros,
        failureRatePpm,
        updatedAt: new Date(),
      },
      eq(schema.circuitBreakerStates.id, id),
    );
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
    return insertReturning(schema.circuitBreakerTransitions, {
      worldId,
      serviceId,
      edgeId: edgeId ?? undefined,
      fromState,
      toState,
      transitionReason: reason,
      eventMicros: nowMicros,
      failureRatePpm,
    });
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
