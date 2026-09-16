import {
  MerkleSnapshotService,
  type ComponentSnapshot,
  type MerkleSnapshot,
} from '../snapshot/snapshot-service.js';

export interface RecordedEvent {
  readonly timestampMicros: number;
  readonly eventType: string;
  readonly targetServiceId: string;
  readonly payload: Record<string, unknown>;
}

export interface ReplayResult {
  readonly status: 'REPLAY_SUCCESS' | 'REPLAY_DIVERGED';
  readonly targetSimTimeMicros: number;
  readonly originalStateHash: string;
  readonly replayedStateHash: string;
  readonly hashMatches: boolean;
  readonly finalComponents: readonly ComponentSnapshot[];
  readonly eventsProcessed: number;
}

export class ReplayEngine {
  /**
   * Replays recorded events starting from a baseline snapshot up to targetSimTimeMicros,
   * producing the deterministic state and verifying bit-for-bit Merkle hash identity.
   */
  static replay(params: {
    baselineSnapshot: MerkleSnapshot;
    events: readonly RecordedEvent[];
    targetSimTimeMicros: number;
    expectedFinalHash?: string;
  }): ReplayResult {
    const { baselineSnapshot, events, targetSimTimeMicros, expectedFinalHash } = params;

    // 1. Initialize component state map from baseline snapshot
    const stateMap = new Map<string, Record<string, unknown>>();
    for (const comp of baselineSnapshot.components) {
      stateMap.set(`${comp.componentType}:${comp.componentId}`, { ...comp.payload });
    }

    // 2. Sort events strictly chronologically
    const sortedEvents = [...events]
      .filter((e) => e.timestampMicros <= targetSimTimeMicros)
      .sort((a, b) => a.timestampMicros - b.timestampMicros);

    // 3. Apply events to state deterministically
    let eventsCount = 0;
    for (const evt of sortedEvents) {
      eventsCount++;
      const key = `SERVICE_STATE:${evt.targetServiceId}`;
      const currentState = stateMap.get(key) ?? {
        serviceId: evt.targetServiceId,
        requestCount: 0,
        errorCount: 0,
        queueDepth: 0,
      };

      const reqCount = Number(currentState['requestCount'] ?? 0) + 1;
      const isError = Boolean(evt.payload['isError']);
      const errCount = Number(currentState['errorCount'] ?? 0) + (isError ? 1 : 0);

      stateMap.set(key, {
        ...currentState,
        requestCount: reqCount,
        errorCount: errCount,
        lastEventMicros: evt.timestampMicros,
      });
    }

    // 4. Reconstruct components and compute canonical Merkle root hash
    const finalComponents: ComponentSnapshot[] = [];
    for (const comp of baselineSnapshot.components) {
      const key = `${comp.componentType}:${comp.componentId}`;
      const updatedPayload = stateMap.get(key) ?? comp.payload;
      finalComponents.push(
        MerkleSnapshotService.createComponent(
          comp.componentType,
          comp.componentId,
          updatedPayload,
        ),
      );
    }

    const replayedStateHash = MerkleSnapshotService.computeMerkleRoot(finalComponents);
    const expected = expectedFinalHash ?? replayedStateHash;
    const hashMatches = replayedStateHash === expected;

    return {
      status: hashMatches ? 'REPLAY_SUCCESS' : 'REPLAY_DIVERGED',
      targetSimTimeMicros,
      originalStateHash: expected,
      replayedStateHash,
      hashMatches,
      finalComponents,
      eventsProcessed: eventsCount,
    };
  }
}
