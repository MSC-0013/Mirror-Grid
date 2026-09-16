import type { NodeMetrics } from './graph-analyzer.js';

export interface TemporalRanking {
  readonly serviceId: string;
  readonly serviceName: string;
  readonly firstAnomalyTimestampMicros: number;
  readonly deltaFromOriginMicros: number;
  readonly precedenceRank: number;
}

/**
 * Orders degraded services chronologically by their first anomaly timestamp (T0).
 * Identifies the origin candidate and calculates the lead-time delta before cascading.
 */
export function rankTemporalPrecedence(nodes: readonly NodeMetrics[]): TemporalRanking[] {
  const degraded = nodes.filter((n) => n.isDegraded);
  if (degraded.length === 0) {
    return [];
  }

  const sorted = [...degraded].sort(
    (a, b) => a.firstAnomalyTimestampMicros - b.firstAnomalyTimestampMicros,
  );

  const originTime = sorted[0]?.firstAnomalyTimestampMicros ?? 0;

  return sorted.map((node, index) => ({
    serviceId: node.serviceId,
    serviceName: node.serviceName,
    firstAnomalyTimestampMicros: node.firstAnomalyTimestampMicros,
    deltaFromOriginMicros: Math.max(0, node.firstAnomalyTimestampMicros - originTime),
    precedenceRank: index + 1,
  }));
}
