import { createHash } from 'node:crypto';
import type { ComponentHash } from './hasher.js';

export interface MerkleResult {
  readonly root: string;
  /** Per-component hashes, sorted by key. The reason divergence is localizable. */
  readonly components: ReadonlyMap<string, ComponentHash>;
}

/**
 * Merkle root over sorted (key, componentHash) pairs.
 *
 * Flat hashing of the whole world would answer "do these two runs differ?" and nothing more.
 * Hashing per component and combining lets replay verification answer "WHICH service or edge
 * drifted?" — and combined with checkpoint bisection, "at which event". That turns a
 * divergence report from "the worlds differ" into
 * "edge orders->payments, event 6118, field retryBudgetTokens".
 */
export class MerkleHash {
  static compute(components: ReadonlyMap<string, ComponentHash>): MerkleResult {
    const keys = Array.from(components.keys()).sort((a, b) =>
      Buffer.compare(Buffer.from(a, 'utf8'), Buffer.from(b, 'utf8'))
    );

    const hasher = createHash('sha256');
    for (const key of keys) {
      const keyBytes = Buffer.from(key, 'utf8');
      const lengthPrefix = Buffer.allocUnsafe(4);
      lengthPrefix.writeUInt32LE(keyBytes.length, 0);
      hasher.update(lengthPrefix);
      hasher.update(keyBytes);
      hasher.update(Buffer.from(components.get(key)!, 'hex'));
    }

    const sorted = new Map<string, ComponentHash>();
    for (const key of keys) {
      sorted.set(key, components.get(key)!);
    }

    return { root: hasher.digest('hex'), components: sorted };
  }

  /** First differing component key, or null when the two roots agree. */
  static firstDivergence(
    expected: ReadonlyMap<string, ComponentHash>,
    actual: ReadonlyMap<string, ComponentHash>
  ): string | null {
    const keys = Array.from(new Set([...expected.keys(), ...actual.keys()])).sort();
    for (const key of keys) {
      if (expected.get(key) !== actual.get(key)) {
        return key;
      }
    }
    return null;
  }
}
