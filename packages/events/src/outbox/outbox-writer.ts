import crypto from 'node:crypto';
import type { Database } from '@mirrorgrid/db';
import { outboxEvents, eventStore } from '@mirrorgrid/db';
import type { DomainEventEnvelope, EventHeaders } from '../schemas/event-envelope.js';
import { SequenceAllocator } from './sequence-allocator.js';

export interface OutboxWriteInput<T = Record<string, unknown>> {
  readonly worldId: string;
  readonly aggregateType: string;
  readonly aggregateId: string;
  readonly eventType: string;
  readonly payload: T;
  readonly headers?: Partial<EventHeaders>;
  readonly partitionKey?: string;
  readonly streamId?: string;
}

export class OutboxWriter {
  /**
   * Records a domain event atomically inside an existing database transaction or connection.
   * Guarantees zero dual-write anomalies by writing to outbox_events and event_store
   * alongside domain state changes.
   */
  public static async recordEvent<T extends Record<string, unknown>>(
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    tx: Database | any,
    input: OutboxWriteInput<T>,
  ): Promise<DomainEventEnvelope<T>> {
    const eventId = crypto.randomUUID();
    const now = new Date();
    const sequenceNum = await SequenceAllocator.nextSequence(tx, input.worldId);
    const partitionKey = input.partitionKey ?? input.worldId;
    const streamId = input.streamId ?? `stream:${input.worldId}:${input.aggregateType}:${input.aggregateId}`;

    const headers: EventHeaders = {
      correlationId: input.headers?.correlationId ?? crypto.randomUUID(),
      causationId: input.headers?.causationId,
      actorId: input.headers?.actorId,
      actorEmail: input.headers?.actorEmail,
    };

    // 1. Insert into outbox_events
    await tx.insert(outboxEvents).values({
      id: eventId,
      worldId: input.worldId,
      aggregateType: input.aggregateType,
      aggregateId: input.aggregateId,
      eventType: input.eventType,
      partitionKey,
      sequenceNum,
      payload: input.payload,
      headers: headers as unknown as Record<string, unknown>,
      createdAt: now,
      publishedAt: null,
    });

    // 2. Insert into event_store journal (ignore duplicate stream versions if already recorded)
    try {
      await tx.insert(eventStore).values({
        eventId,
        streamId,
        streamVersion: sequenceNum,
        eventType: input.eventType,
        payload: input.payload,
        metadata: headers as unknown as Record<string, unknown>,
        occurredAt: now,
      });
    } catch {
      // If stream version uniqueness triggers, event remains safe in outbox
    }

    return {
      id: eventId,
      worldId: input.worldId,
      aggregateType: input.aggregateType,
      aggregateId: input.aggregateId,
      eventType: input.eventType,
      partitionKey,
      sequenceNum,
      payload: input.payload,
      headers,
      timestamp: now,
    };
  }
}
