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

    // MySQL's INSERT IGNORE relies on the composite PRIMARY KEY (event_id, consumer_group)
    // to silently no-op on a duplicate rather than error — that primary key is what makes
    // this dedupe correct, not the IGNORE keyword alone. db.execute() (not db.run(), which
    // does not exist on the mysql2 driver) returns the raw mysql2 tuple, so affectedRows
    // is read off the first element.
    const [insertResult] = await db.execute(sql`
      INSERT IGNORE INTO ${consumedEvents} (event_id, consumer_group, processed_at)
      VALUES (${event.id}, ${consumerGroup}, ${now})
    `);

    const wasInserted = (insertResult as { affectedRows?: number }).affectedRows === 1;

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
