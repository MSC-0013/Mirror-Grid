import type { ComponentSnapshot, MerkleSnapshot } from './snapshot-service.js';

export interface StorageMetrics {
  readonly totalSnapshots: number;
  readonly totalComponentsObserved: number;
  readonly uniquePayloadsStored: number;
  readonly deduplicatedCount: number;
  readonly deduplicationRatio: number; // e.g. 0.85 for 85%
  readonly rawBytes: number;
  readonly storedBytes: number;
}

export class DeduplicatedStorage {
  private readonly payloadStore = new Map<string, Record<string, unknown>>();
  private totalComponents = 0;
  private deduplicatedComponents = 0;
  private rawBytes = 0;
  private storedBytes = 0;
  private snapshotCount = 0;

  /**
   * Stores a snapshot's components into content-addressable storage.
   */
  storeSnapshot(snapshot: MerkleSnapshot): MerkleSnapshot {
    this.snapshotCount++;
    const processedComponents: ComponentSnapshot[] = [];

    for (const c of snapshot.components) {
      this.totalComponents++;
      const payloadStr = JSON.stringify(c.payload);
      this.rawBytes += payloadStr.length;

      if (this.payloadStore.has(c.componentHash) || c.isDeduplicated) {
        this.deduplicatedComponents++;
        this.storedBytes += c.componentHash.length; // pointer only
        processedComponents.push({
          ...c,
          isDeduplicated: true,
          payload: {},
        });
      } else {
        this.payloadStore.set(c.componentHash, c.payload);
        this.storedBytes += payloadStr.length;
        processedComponents.push({
          ...c,
          isDeduplicated: false,
        });
      }
    }

    return {
      ...snapshot,
      components: processedComponents,
      totalComponents: snapshot.components.length,
      deduplicatedComponents: processedComponents.filter((c) => c.isDeduplicated).length,
    };
  }

  /**
   * Hydrates a snapshot by resolving deduplicated components from the content-addressable store.
   */
  hydrateSnapshot(snapshot: MerkleSnapshot): MerkleSnapshot {
    const hydratedComponents = snapshot.components.map((c) => {
      if (c.isDeduplicated) {
        const stored = this.payloadStore.get(c.componentHash);
        return {
          ...c,
          payload: stored ?? {},
        };
      }
      return c;
    });

    return {
      ...snapshot,
      components: hydratedComponents,
    };
  }

  getMetrics(): StorageMetrics {
    const ratio =
      this.totalComponents > 0
        ? Number((this.deduplicatedComponents / this.totalComponents).toFixed(4))
        : 0;

    return {
      totalSnapshots: this.snapshotCount,
      totalComponentsObserved: this.totalComponents,
      uniquePayloadsStored: this.payloadStore.size,
      deduplicatedCount: this.deduplicatedComponents,
      deduplicationRatio: ratio,
      rawBytes: this.rawBytes,
      storedBytes: this.storedBytes,
    };
  }
}
