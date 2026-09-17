import { sql, isNull, inArray } from 'drizzle-orm';
import { db, outboxEvents } from '@mirrorgrid/db';
import type { DomainEventEnvelope } from '../schemas/event-envelope.js';
import { EventBus } from '../bus/event-bus.js';

export interface OutboxRelayOptions {
  batchSize?: number;
  pollIntervalMs?: number;
}

export interface OutboxRelayStatus {
  pendingCount: number;
  oldestPendingAgeMs: number;
  relayLagMs: number;
  isRunning: boolean;
  totalPublished: number;
}

export class OutboxRelay {
  private isRunning = false;
  private timer: NodeJS.Timeout | null = null;
  private readonly batchSize: number;
  private readonly pollIntervalMs: number;
  private totalPublished = 0;
  private lastPollAt: number = Date.now();

  constructor(options: OutboxRelayOptions = {}) {
    this.batchSize = options.batchSize ?? 50;
    this.pollIntervalMs = options.pollIntervalMs ?? 200;
  }

  public start(): void {
    if (this.isRunning) return;
    this.isRunning = true;
    this.schedulePoll();
  }

  public stop(): void {
    this.isRunning = false;
    if (this.timer) {
      clearTimeout(this.timer);
      this.timer = null;
    }
  }

  private schedulePoll(): void {
    if (!this.isRunning) return;
    this.timer = setTimeout(async () => {
      try {
        await this.processBatch();
      } catch (err) {
        console.error('[OutboxRelay] Error processing batch:', err);
      } finally {
        if (this.isRunning) {
          this.schedulePoll();
        }
      }
    }, this.pollIntervalMs);
  }

  /**
   * Processes a single batch of unpublished events.
   * Returns the count of events successfully published and acknowledged.
   */
  public async processBatch(): Promise<number> {
    this.lastPollAt = Date.now();

    // 1. Fetch unpublished events ordered by createdAt
    const rows = await db
      .select()
      .from(outboxEvents)
      .where(isNull(outboxEvents.publishedAt))
      .orderBy(outboxEvents.createdAt)
      .limit(this.batchSize);

    if (rows.length === 0) {
      return 0;
    }

    const bus = EventBus.getInstance();
    const publishedIds: string[] = [];
    const now = new Date();

    for (const row of rows) {
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

      const topic = `world:${row.worldId}:events`;
      await bus.publish(topic, envelope);
      // Also publish to general events topic
      await bus.publish(`events:${row.eventType}`, envelope);

      publishedIds.push(row.id);
    }

    // 2. Mark events as published
    if (publishedIds.length > 0) {
      await db
        .update(outboxEvents)
        .set({ publishedAt: now })
        .where(inArray(outboxEvents.id, publishedIds));

      this.totalPublished += publishedIds.length;
    }

    return publishedIds.length;
  }

  /**
   * Retrieves relay health statistics.
   */
  public async getStatus(): Promise<OutboxRelayStatus> {
    const res = await db
      .select({
        count: sql<number>`COUNT(*)`,
        oldest: sql<number | null>`MIN(${outboxEvents.createdAt})`,
      })
      .from(outboxEvents)
      .where(isNull(outboxEvents.publishedAt));

    const pendingCount = res[0]?.count ?? 0;
    const oldestTimestamp = res[0]?.oldest;
    const nowMs = Date.now();
    const oldestPendingAgeMs =
      oldestTimestamp !== null && oldestTimestamp !== undefined
        ? Math.max(0, nowMs - new Date(oldestTimestamp).getTime())
        : 0;

    return {
      pendingCount,
      oldestPendingAgeMs,
      relayLagMs: Math.max(0, nowMs - this.lastPollAt),
      isRunning: this.isRunning,
      totalPublished: this.totalPublished,
    };
  }

  /**
   * Purges published events older than retentionDays.
   */
  public async purgePublishedEvents(retentionDays = 7): Promise<number> {
    const cutoff = new Date(Date.now() - retentionDays * 86400000);
    const result = await db
      .delete(outboxEvents)
      .where(
        sql`${outboxEvents.publishedAt} IS NOT NULL AND ${outboxEvents.createdAt} < ${cutoff.getTime()}`,
      );

    return (result as { rowsAffected?: number })?.rowsAffected ?? 0;
  }
}
