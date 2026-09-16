import { sql } from 'drizzle-orm';
import type { Database } from '@mirrorgrid/db';
import { outboxEvents } from '@mirrorgrid/db';

export class SequenceAllocator {
  private static sequenceCounters = new Map<string, number>();

  /**
   * Allocates the next strictly monotonic sequence number for a world.
   * Can be executed inside an active transaction or standalone.
   */
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  public static async nextSequence(tx: Database | any, worldId: string): Promise<number> {
    const res = await tx
      .select({
        maxSeq: sql<number | null>`MAX(${outboxEvents.sequenceNum})`,
      })
      .from(outboxEvents)
      .where(sql`${outboxEvents.worldId} = ${worldId}`);

    const maxDbSeq = res[0]?.maxSeq ?? 0;
    return maxDbSeq + 1;
  }

  /**
   * Resets cached sequence numbers (useful for testing).
   */
  public static reset(worldId?: string) {
    if (worldId) {
      this.sequenceCounters.delete(worldId);
    } else {
      this.sequenceCounters.clear();
    }
  }
}
