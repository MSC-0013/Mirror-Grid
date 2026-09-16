import { createICDFTable, type ICDFTable } from './loader.js';

/**
 * Generates an integer ICDF lookup table for a Bimodal (Healthy + Slow Tail) distribution.
 */
export function generateBimodalTable(
  healthyMeanUs: number,
  tailMeanUs: number,
  tailProbability: number,
  size: number = 4096
): ICDFTable {
  const buckets = new Int32Array(size);
  const healthyThreshold = 1 - tailProbability;

  for (let i = 0; i < size; i++) {
    const p = (i + 0.5) / size;
    let val: number;

    if (p < healthyThreshold) {
      // Scale p to [0, 1) within the healthy mode
      const pScaled = p / healthyThreshold;
      val = Math.round(-healthyMeanUs * Math.log(1 - pScaled));
    } else {
      // Scale p to [0, 1) within the tail mode
      const pScaled = (p - healthyThreshold) / tailProbability;
      val = Math.round(healthyMeanUs + -tailMeanUs * Math.log(1 - pScaled));
    }

    buckets[i] = Math.max(1, val);
  }

  return createICDFTable(
    'bimodal',
    { healthyMeanUs, tailMeanUs, tailProbability, size },
    buckets
  );
}
