/**
 * Service Level Indicator (SLI) calculations.
 * Pure mathematical functions for Availability and Latency SLIs.
 */

export type SliType = 'AVAILABILITY' | 'LATENCY_P99' | 'LATENCY_P95';

export interface SloConfig {
  readonly id: string;
  readonly worldId: string;
  readonly serviceId: string;
  readonly name: string;
  readonly type: SliType;
  readonly targetPercentage: number; // e.g. 99.9
  readonly windowSeconds: number; // default 2592000 (30 days)
  readonly thresholdLatencyMicros?: number;
}

export interface RequestSample {
  readonly isError: boolean;
  readonly durationMicros: number;
  readonly timestampMicros?: number;
}

export interface SliEvaluationResult {
  readonly currentPercentage: number;
  readonly totalRequests: number;
  readonly badRequests: number;
  readonly goodRequests: number;
}

/**
 * Calculates availability SLI as percentage: (goodRequests / totalRequests) * 100.
 * Handles zero requests gracefully by returning 100.0 (prevents NaN / division by zero).
 */
export function calculateAvailabilitySli(totalCount: number, errorCount: number): number {
  if (totalCount <= 0) {
    return 100.0;
  }
  const good = Math.max(0, totalCount - errorCount);
  return Number(((good / totalCount) * 100).toFixed(4));
}

/**
 * Calculates latency SLI as percentage of requests meeting or beating the latency threshold.
 */
export function calculateLatencySli(
  samples: readonly { durationMicros: number; isError?: boolean }[],
  thresholdMicros: number,
): number {
  if (samples.length === 0) {
    return 100.0;
  }
  let good = 0;
  for (const s of samples) {
    if (!s.isError && s.durationMicros <= thresholdMicros) {
      good++;
    }
  }
  return Number(((good / samples.length) * 100).toFixed(4));
}

/**
 * Calculates given percentile (0 to 100) from an array of numbers.
 */
export function calculatePercentile(values: readonly number[], percentile: number): number {
  if (values.length === 0) {
    return 0;
  }
  const sorted = [...values].sort((a, b) => a - b);
  const index = Math.ceil((percentile / 100) * sorted.length) - 1;
  const clampedIndex = Math.max(0, Math.min(sorted.length - 1, index));
  return sorted[clampedIndex] ?? 0;
}

/**
 * Evaluates SLI compliance against a given SLO configuration.
 */
export function evaluateSli(
  config: SloConfig,
  samples: readonly RequestSample[],
): SliEvaluationResult {
  const totalRequests = samples.length;
  if (totalRequests === 0) {
    return {
      currentPercentage: 100.0,
      totalRequests: 0,
      badRequests: 0,
      goodRequests: 0,
    };
  }

  let badRequests = 0;

  if (config.type === 'AVAILABILITY') {
    for (const sample of samples) {
      if (sample.isError) {
        badRequests++;
      }
    }
    const currentPercentage = calculateAvailabilitySli(totalRequests, badRequests);
    return {
      currentPercentage,
      totalRequests,
      badRequests,
      goodRequests: totalRequests - badRequests,
    };
  }

  // LATENCY_P99 / LATENCY_P95
  const threshold = config.thresholdLatencyMicros ?? 500_000; // default 500ms
  for (const sample of samples) {
    if (sample.isError || sample.durationMicros > threshold) {
      badRequests++;
    }
  }

  const currentPercentage = calculateLatencySli(samples, threshold);
  return {
    currentPercentage,
    totalRequests,
    badRequests,
    goodRequests: totalRequests - badRequests,
  };
}
