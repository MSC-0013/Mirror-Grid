import type { MerkleSnapshot } from '../snapshot/snapshot-service.js';

export interface BisectionDifference {
  readonly simTimeMicros: number;
  readonly componentType: string;
  readonly componentId: string;
  readonly run1Hash: string;
  readonly run2Hash: string;
  readonly run1Payload: unknown;
  readonly run2Payload: unknown;
  readonly iterationCount: number;
}

export class CheckpointBisector {
  /**
   * Performs an exact binary search across two snapshot timelines to pinpoint
   * the exact microsecond and component where state divergence first occurred.
   *
   * Completes in O(log N) iterations.
   */
  static findDivergence(
    run1Snapshots: readonly MerkleSnapshot[],
    run2Snapshots: readonly MerkleSnapshot[],
  ): BisectionDifference | null {
    const len = Math.min(run1Snapshots.length, run2Snapshots.length);
    if (len === 0) {
      return null;
    }

    // Quick check: if the last snapshot matches and all lengths match, no divergence
    if (
      run1Snapshots.length === run2Snapshots.length &&
      run1Snapshots[len - 1]?.merkleRootHash === run2Snapshots[len - 1]?.merkleRootHash
    ) {
      // Full equality check
      let hasDifference = false;
      for (let i = 0; i < len; i++) {
        if (run1Snapshots[i]!.merkleRootHash !== run2Snapshots[i]!.merkleRootHash) {
          hasDifference = true;
          break;
        }
      }
      if (!hasDifference) return null;
    }

    let low = 0;
    let high = len - 1;
    let iterationCount = 0;

    while (low < high) {
      iterationCount++;
      const mid = Math.floor((low + high) / 2);
      const s1 = run1Snapshots[mid]!;
      const s2 = run2Snapshots[mid]!;

      if (s1.merkleRootHash === s2.merkleRootHash) {
        low = mid + 1;
      } else {
        high = mid;
      }
    }

    // low is now the first divergent index
    const divIndex = low;
    const s1 = run1Snapshots[divIndex]!;
    const s2 = run2Snapshots[divIndex]!;

    if (s1.merkleRootHash === s2.merkleRootHash) {
      return null; // No divergence found
    }

    // Isolate the specific differing component
    const s2Map = new Map<string, typeof s2.components[number]>();
    for (const c of s2.components) {
      s2Map.set(`${c.componentType}:${c.componentId}`, c);
    }

    for (const c1 of s1.components) {
      const key = `${c1.componentType}:${c1.componentId}`;
      const c2 = s2Map.get(key);
      if (!c2 || c1.componentHash !== c2.componentHash) {
        return {
          simTimeMicros: s1.simTimeMicros,
          componentType: c1.componentType,
          componentId: c1.componentId,
          run1Hash: c1.componentHash,
          run2Hash: c2 ? c2.componentHash : 'MISSING',
          run1Payload: c1.payload,
          run2Payload: c2 ? c2.payload : null,
          iterationCount,
        };
      }
    }

    // If all s1 components matched, check for extra component in s2
    for (const c2 of s2.components) {
      const key = `${c2.componentType}:${c2.componentId}`;
      const c1 = s1.components.find((c) => `${c.componentType}:${c.componentId}` === key);
      if (!c1) {
        return {
          simTimeMicros: s2.simTimeMicros,
          componentType: c2.componentType,
          componentId: c2.componentId,
          run1Hash: 'MISSING',
          run2Hash: c2.componentHash,
          run1Payload: null,
          run2Payload: c2.payload,
          iterationCount,
        };
      }
    }

    return null;
  }
}
