import type { ICDFTable } from './loader.js';
import { generateExponentialTable } from './exponential.js';
import { generateTruncatedNormalTable } from './normal.js';
import { generateLognormalTable } from './lognormal.js';
import { generateBimodalTable } from './bimodal.js';

export class ICDFRegistry {
  private readonly tables = new Map<string, ICDFTable>();

  constructor() {
    this.registerDefaults();
  }

  private registerDefaults(): void {
    // 5ms fast service
    this.register('default_fast', generateExponentialTable(5_000));
    // 20ms standard service (e.g. Orders, Gateway)
    this.register('default_service', generateExponentialTable(20_000));
    // 50ms normal distribution
    this.register('default_normal', generateTruncatedNormalTable(50_000, 10_000, 5_000));
    // 30ms lognormal distribution
    this.register('default_lognormal', generateLognormalTable(30_000, 0.5));
    // Degraded payments: 20ms healthy, 900ms tail with 10% probability
    this.register('degraded_tail', generateBimodalTable(20_000, 900_000, 0.1));
    // Poisson inter-arrival gaps, mean 1s. Scaled by the requested rate at sample time,
    // so one table serves every workload rate and the hashed table bytes never change.
    this.register('interarrival_1s', generateExponentialTable(1_000_000));
  }

  register(key: string, table: ICDFTable): void {
    this.tables.set(key, table);
  }

  /**
   * Strict lookup. An unknown key is a programming error, never a fallback.
   *
   * Silently substituting a different distribution would change sampled service times —
   * and therefore event ordering and the state hash — with no error and no diff. A typo
   * in a table name must fail loudly, not quietly produce a different universe.
   */
  get(key: string): ICDFTable {
    const table = this.tables.get(key);
    if (!table) {
      throw new Error(
        `Unknown ICDF table "${key}". Registered: ${Array.from(this.tables.keys()).sort().join(', ')}`,
      );
    }
    return table;
  }

  has(key: string): boolean {
    return this.tables.has(key);
  }

  /** Sorted by key so the manifest is byte-stable regardless of registration order. */
  getManifest(): Record<string, { hash: string; params: Record<string, number> }> {
    const manifest: Record<string, { hash: string; params: Record<string, number> }> = {};
    for (const key of Array.from(this.tables.keys()).sort()) {
      const table = this.tables.get(key)!;
      manifest[key] = { hash: table.hash, params: table.params };
    }
    return manifest;
  }

  /**
   * Verify generated tables against the checked-in manifest.
   *
   * These tables are generated at process start using Math.log / Math.exp / Math.sqrt,
   * which are NOT correctly rounded under IEEE-754. A different V8 build can differ by one
   * ULP; after rounding to integer microseconds that can flip a boundary value, shift one
   * sampled service time, reorder two heap events, and change the state hash.
   *
   * Rather than pretending that cannot happen, every table's SHA-256 is compared against
   * `manifest.json` at startup. Drift then surfaces here, immediately and by name, instead
   * of as an unexplained replay divergence weeks later.
   */
  verifyAgainstManifest(
    expected: Record<string, { hash: string }>,
  ): { ok: true } | { ok: false; mismatches: string[] } {
    const mismatches: string[] = [];

    for (const key of Object.keys(expected).sort()) {
      const table = this.tables.get(key);
      if (!table) {
        mismatches.push(`${key}: missing from registry`);
      } else if (table.hash !== expected[key].hash) {
        mismatches.push(
          `${key}: expected ${expected[key].hash.slice(0, 16)}…, got ${table.hash.slice(0, 16)}…`,
        );
      }
    }
    for (const key of Array.from(this.tables.keys()).sort()) {
      if (!(key in expected)) {
        mismatches.push(`${key}: present in registry but absent from manifest`);
      }
    }
    return mismatches.length === 0 ? { ok: true } : { ok: false, mismatches };
  }
}

export const defaultICDFRegistry = new ICDFRegistry();
