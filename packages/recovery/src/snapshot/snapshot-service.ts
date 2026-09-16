import { canonicalStringify, sha256 } from './serializer.js';

export type ComponentType =
  | 'SERVICE_STATE'
  | 'CIRCUIT_BREAKER'
  | 'QUEUE_STATE'
  | 'FAULT_STATE';

export interface ComponentSnapshot {
  readonly componentType: ComponentType;
  readonly componentId: string;
  readonly componentHash: string;
  readonly payload: Record<string, unknown>;
  readonly isDeduplicated?: boolean;
}

export interface MerkleSnapshot {
  readonly id: string;
  readonly worldId: string;
  readonly experimentRunId?: string;
  readonly simTimeMicros: number;
  readonly sequenceNum: number;
  readonly merkleRootHash: string;
  readonly snapshotType: 'PERIODIC' | 'TRIGGERED' | 'MANUAL' | 'PRE_FAULT';
  readonly triggerReason?: string;
  readonly totalComponents: number;
  readonly deduplicatedComponents: number;
  readonly sizeBytes: number;
  readonly components: readonly ComponentSnapshot[];
}

export class MerkleSnapshotService {
  /**
   * Computes individual component hash and returns verified ComponentSnapshot.
   */
  static createComponent(
    componentType: ComponentType,
    componentId: string,
    payload: Record<string, unknown>,
  ): ComponentSnapshot {
    const serialized = canonicalStringify(payload);
    const componentHash = sha256(serialized);
    return {
      componentType,
      componentId,
      componentHash,
      payload,
      isDeduplicated: false,
    };
  }

  /**
   * Computes the canonical Merkle root hash from an array of components.
   * Components are deterministically sorted by type and ID.
   */
  static computeMerkleRoot(components: readonly ComponentSnapshot[]): string {
    const sorted = [...components].sort((a, b) => {
      const typeCmp = a.componentType.localeCompare(b.componentType);
      if (typeCmp !== 0) return typeCmp;
      return a.componentId.localeCompare(b.componentId);
    });

    const lines = sorted.map(
      (c) => `${c.componentType}:${c.componentId}:${c.componentHash}`,
    );
    return sha256(lines.join('\n'));
  }

  /**
   * Constructs an incremental MerkleSnapshot, applying content-addressable deduplication
   * against the preceding snapshot if provided.
   */
  static createSnapshot(params: {
    id?: string;
    worldId: string;
    experimentRunId?: string;
    simTimeMicros: number;
    sequenceNum: number;
    components: readonly ComponentSnapshot[];
    previousSnapshot?: MerkleSnapshot;
    snapshotType?: 'PERIODIC' | 'TRIGGERED' | 'MANUAL' | 'PRE_FAULT';
    triggerReason?: string;
  }): MerkleSnapshot {
    const id = params.id ?? crypto.randomUUID();
    const prevMap = new Map<string, string>();
    if (params.previousSnapshot) {
      for (const c of params.previousSnapshot.components) {
        prevMap.set(`${c.componentType}:${c.componentId}`, c.componentHash);
      }
    }

    let dedupCount = 0;
    let totalBytes = 0;

    const deduplicatedComponents: ComponentSnapshot[] = params.components.map((c) => {
      const key = `${c.componentType}:${c.componentId}`;
      const prevHash = prevMap.get(key);
      const isDedup = prevHash !== undefined && prevHash === c.componentHash;

      if (isDedup) {
        dedupCount++;
        // Payload size in deduplicated state is minimal (reference only)
        totalBytes += c.componentHash.length;
        return {
          ...c,
          isDeduplicated: true,
          payload: {}, // Elide duplicated payload
        };
      } else {
        const payloadStr = canonicalStringify(c.payload);
        totalBytes += payloadStr.length;
        return {
          ...c,
          isDeduplicated: false,
        };
      }
    });

    const merkleRootHash = MerkleSnapshotService.computeMerkleRoot(params.components);

    return {
      id,
      worldId: params.worldId,
      experimentRunId: params.experimentRunId,
      simTimeMicros: params.simTimeMicros,
      sequenceNum: params.sequenceNum,
      merkleRootHash,
      snapshotType: params.snapshotType ?? 'PERIODIC',
      triggerReason: params.triggerReason,
      totalComponents: params.components.length,
      deduplicatedComponents: dedupCount,
      sizeBytes: totalBytes,
      components: deduplicatedComponents,
    };
  }
}
