import { createHash } from 'node:crypto';
import type { SubStream } from '../rng/substream.js';

export interface ICDFTable {
  readonly name: string;
  readonly params: Record<string, number>;
  readonly buckets: Int32Array; // integer microseconds
  readonly hash: string; // SHA-256 of bucket bytes
  sample(rng: SubStream): number; // returns integer microseconds
}

export function createICDFTable(
  name: string,
  params: Record<string, number>,
  buckets: Int32Array,
): ICDFTable {
  // Hash the raw byte buffer of the Int32Array
  const buffer = Buffer.from(buckets.buffer, buckets.byteOffset, buckets.byteLength);
  const hash = createHash('sha256').update(buffer).digest('hex');

  return {
    name,
    params,
    buckets,
    hash,
    sample(rng: SubStream): number {
      const idx = rng.nextIntRange(0, buckets.length - 1);
      return buckets[idx];
    },
  };
}
