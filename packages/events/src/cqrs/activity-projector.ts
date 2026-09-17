import { sql } from 'drizzle-orm';
import { db, worldActivityFeed, projectionCheckpoints, outboxEvents } from '@mirrorgrid/db';
import type { DomainEventEnvelope } from '../schemas/event-envelope.js';
import { EventBus, type Subscription } from '../bus/event-bus.js';
import { IdempotentConsumer } from '../consumer/idempotent-consumer.js';

export interface ActivityFeedItem {
  id: string;
  worldId: string;
  eventId: string;
  eventType: string;
  actorEmail?: string;
  severity: 'INFO' | 'WARNING' | 'CRITICAL';
  summary: string;
  details: Record<string, unknown>;
  occurredAt: Date;
  createdAt: Date;
}

export class ActivityProjector {
  private subscription: Subscription | null = null;
  private readonly consumerGroup = 'activity_projector';

  public start(): void {
    if (this.subscription) return;
    const bus = EventBus.getInstance();
    this.subscription = bus.subscribe('*', async (event) => {
      await this.handleEvent(event);
    });
  }

  public stop(): void {
    if (this.subscription) {
      this.subscription.unsubscribe();
      this.subscription = null;
    }
  }

  public async handleEvent(event: DomainEventEnvelope): Promise<void> {
    if (!event.worldId) return;

    await IdempotentConsumer.consume(event, this.consumerGroup, async (e) => {
      const { severity, summary } = this.formatActivity(e);
      const now = new Date();

      await db.insert(worldActivityFeed).values({
        id: crypto.randomUUID(),
        worldId: e.worldId,
        eventId: e.id,
        eventType: e.eventType,
        actorEmail: e.headers.actorEmail,
        severity,
        summary,
        details: e.payload as Record<string, unknown>,
        occurredAt: e.timestamp,
        createdAt: now,
      });

      // Broadcast formatted activity item to the activity channel
      const bus = EventBus.getInstance();
      await bus.publish(`world:${e.worldId}:activity`, {
        ...e,
        payload: {
          severity,
          summary,
          details: e.payload,
        },
      });
    });
  }

  public formatActivity(event: DomainEventEnvelope): {
    severity: 'INFO' | 'WARNING' | 'CRITICAL';
    summary: string;
  } {
    const payload = (event.payload ?? {}) as Record<string, unknown>;

    switch (event.eventType) {
      case 'CIRCUIT_TRIPPED':
        return {
          severity: 'CRITICAL',
          summary: `Circuit breaker on edge ${payload.edgeId ?? event.aggregateId} tripped to OPEN (${payload.failureRatePpm ? Math.round(Number(payload.failureRatePpm) / 10000) : 100}% failure rate)`,
        };
      case 'CIRCUIT_RESET':
        return {
          severity: 'INFO',
          summary: `Circuit breaker on edge ${payload.edgeId ?? event.aggregateId} recovered to CLOSED`,
        };
      case 'FAULT_INJECTED':
        return {
          severity: 'WARNING',
          summary: `Fault injected: ${payload.faultType ?? 'LATENCY'} on ${payload.serviceId ?? payload.edgeId ?? event.aggregateId}`,
        };
      case 'FAULT_REMOVED':
        return {
          severity: 'INFO',
          summary: `Fault removed from ${payload.serviceId ?? payload.edgeId ?? event.aggregateId}`,
        };
      case 'PHASE_CHANGED':
        return {
          severity: 'INFO',
          summary: `Experiment transitioned to phase: ${payload.phase ?? 'RUNNING'}`,
        };
      case 'EXPERIMENT_STARTED':
        return {
          severity: 'INFO',
          summary: `Experiment ${payload.experimentId ?? event.aggregateId} started`,
        };
      case 'EXPERIMENT_COMPLETED':
        return {
          severity: 'INFO',
          summary: `Experiment ${payload.experimentId ?? event.aggregateId} finished successfully`,
        };
      case 'JOB_FAILED':
        return {
          severity: 'WARNING',
          summary: `Async job ${payload.jobId ?? event.aggregateId} failed: ${payload.reason ?? 'Unknown error'}`,
        };
      case 'ANOMALY_DETECTED':
        return {
          severity: 'CRITICAL',
          summary: `Anomaly detected by ${payload.detectorId ?? 'detector'}: ${payload.message ?? 'Threshold exceeded'}`,
        };
      default:
        return {
          severity: 'INFO',
          summary: `${event.eventType} recorded for ${event.aggregateType} ${event.aggregateId}`,
        };
    }
  }

  /**
   * Replays historical events to rebuild the world_activity_feed projection from scratch.
   */
  public async rebuildProjection(worldId?: string): Promise<{ replayedCount: number }> {
    // 1. Clear existing projected activity for target world or all
    if (worldId) {
      await db.delete(worldActivityFeed).where(sql`${worldActivityFeed.worldId} = ${worldId}`);
    } else {
      await db.delete(worldActivityFeed);
    }

    // 2. Fetch recorded events in order
    const query = db.select().from(outboxEvents);
    if (worldId) {
      query.where(sql`${outboxEvents.worldId} = ${worldId}`);
    }
    const events = await query.orderBy(outboxEvents.sequenceNum);

    let replayedCount = 0;
    for (const row of events) {
      const envelope: DomainEventEnvelope = {
        id: row.id,
        worldId: row.worldId,
        aggregateType: row.aggregateType,
        aggregateId: row.aggregateId,
        eventType: row.eventType,
        partitionKey: row.partitionKey,
        sequenceNum: row.sequenceNum,
        payload: row.payload as Record<string, unknown>,
        headers: row.headers as unknown as DomainEventEnvelope['headers'],
        timestamp: row.createdAt,
      };

      const { severity, summary } = this.formatActivity(envelope);
      await db.insert(worldActivityFeed).values({
        id: crypto.randomUUID(),
        worldId: envelope.worldId,
        eventId: envelope.id,
        eventType: envelope.eventType,
        actorEmail: envelope.headers.actorEmail,
        severity,
        summary,
        details: envelope.payload as Record<string, unknown>,
        occurredAt: envelope.timestamp,
        createdAt: new Date(),
      });
      replayedCount++;
    }

    // Update projection checkpoint. MySQL's upsert infers the conflicting key from
    // whichever unique constraint collides, so unlike onConflictDoUpdate there is no
    // `target` to name.
    await db
      .insert(projectionCheckpoints)
      .values({
        projectionName: 'world_activity_feed',
        lastProcessedSeq: replayedCount,
        updatedAt: new Date(),
      })
      .onDuplicateKeyUpdate({
        set: {
          lastProcessedSeq: replayedCount,
          updatedAt: new Date(),
        },
      });

    return { replayedCount };
  }
}
