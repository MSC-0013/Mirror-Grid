import { createICDFTable, type ICDFTable } from './loader.js';

/**
 * Generates an integer ICDF lookup table for an Exponential distribution.
 * Inverse CDF: F^-1(p) = -mean * ln(1 - p)
 */
export function generateExponentialTable(meanUs: number, size: number = 4096): ICDFTable {
  const buckets = new Int32Array(size);

  for (let i = 0; i < size; i++) {
    const p = (i + 0.5) / size;
    // Math.log is used offline during table generation only, never on the hot path
    const val = Math.round(-meanUs * Math.log(1 - p));
    buckets[i] = Math.max(0, val);
  }

  return createICDFTable('exponential', { meanUs, size }, buckets);
}
