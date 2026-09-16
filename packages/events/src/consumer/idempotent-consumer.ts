import { sql } from 'drizzle-orm';
import { db, consumedEvents } from '@mirrorgrid/db';
import type { DomainEventEnvelope } from '../schemas/event-envelope.js';

export interface ConsumeResult {
  readonly processed: boolean;
  readonly duplicate: boolean;
}

export class IdempotentConsumer {
  /**
   * Processes a domain event idempotently.
   * If the event has already been processed by consumerGroup, execution is safely skipped.
   */
  public static async consume<T>(
    event: DomainEventEnvelope<T>,
    consumerGroup: string,
    handler: (event: DomainEventEnvelope<T>) => Promise<void> | void,
  ): Promise<ConsumeResult> {
    const now = new Date();

    // In SQLite, perform INSERT OR IGNORE
    const insertResult = await db.run(sql`
      INSERT OR IGNORE INTO ${consumedEvents} (event_id, consumer_group, processed_at)
      VALUES (${event.id}, ${consumerGroup}, ${now.getTime()})
    `);

    // Check if a row was actually inserted
    const wasInserted = (insertResult as { rowsAffected?: number }).rowsAffected === 1;

    if (!wasInserted) {
      // Event has already been processed by this consumer group
      return { processed: false, duplicate: true };
    }

    // First time seeing event for this consumer group: invoke handler
    await handler(event);
    return { processed: true, duplicate: false };
  }

  /**
   * Checks if an event has already been recorded by the specified consumer group.
   */
  public static async isConsumed(eventId: string, consumerGroup: string): Promise<boolean> {
    const res = await db
      .select({ id: consumedEvents.eventId })
      .from(consumedEvents)
      .where(sql`${consumedEvents.eventId} = ${eventId} AND ${consumedEvents.consumerGroup} = ${consumerGroup}`)
      .limit(1);

    return res.length > 0;
  }
}
