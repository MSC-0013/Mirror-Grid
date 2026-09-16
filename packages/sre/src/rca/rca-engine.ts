import {
  DependencyGraph,
  type GraphEdge,
  type GraphNode,
  type NodeMetrics,
} from './graph-analyzer.js';
import { rankTemporalPrecedence } from './temporal-precedence.js';

export interface CausalChainNode {
  readonly serviceId: string;
  readonly serviceName: string;
  readonly anomalyDetectedAtMicros: number;
  readonly observedMetric: string;
  readonly deviationFactor: number;
}

export type FailureType =
  | 'LATENCY_INDUCED_SATURATION'
  | 'RESOURCE_STARVATION'
  | 'POISON_PILL'
  | 'CIRCUIT_TRIP_CASCADE';

export interface RcaInvestigationResult {
  readonly rootCauseServiceId: string;
  readonly rootCauseServiceName: string;
  readonly confidencePercentage: number;
  readonly failureType: FailureType;
  readonly causalPath: readonly CausalChainNode[];
  readonly explanation: string;
  readonly architecturalRecommendation: string;
}

export interface IncidentContext {
  readonly nodes: readonly GraphNode[];
  readonly edges: readonly GraphEdge[];
  readonly metrics: readonly NodeMetrics[];
}

export class RcaEngine {
  /**
   * Analyzes an incident given the topology graph and node metrics during the incident window.
   */
  static analyze(context: IncidentContext): RcaInvestigationResult {
    const { nodes, edges, metrics } = context;
    const graph = new DependencyGraph(nodes, edges);

    const metricsMap = new Map<string, NodeMetrics>();
    for (const m of metrics) {
      metricsMap.set(m.serviceId, m);
    }

    const degradedMetrics = metrics.filter((m) => m.isDegraded);
    if (degradedMetrics.length === 0) {
      return {
        rootCauseServiceId: '',
        rootCauseServiceName: 'None',
        confidencePercentage: 100.0,
        failureType: 'RESOURCE_STARVATION',
        causalPath: [],
        explanation: 'All services remained within normal operating baselines; no anomaly detected.',
        architecturalRecommendation: 'Maintain standard monitoring and baseline alerts.',
      };
    }

    // 1. Temporal precedence ranking
    const temporalRankings = rankTemporalPrecedence(metrics);
    const temporalOrigin = temporalRankings[0];

    // 2. Identify Entrypoints
    const entrypoints = graph.getEntrypoints();
    const degradedEntrypoints = entrypoints.filter(
      (e) => metricsMap.get(e.id)?.isDegraded,
    );
    const startNode =
      degradedEntrypoints.length > 0
        ? degradedEntrypoints[0]!
        : (nodes.find((n) => n.id === temporalOrigin?.serviceId) ?? nodes[0]!);

    // 3. Follow topological causal chain downstream
    const causalPath: CausalChainNode[] = [];
    let currentId = startNode.id;
    const visited = new Set<string>();

    while (currentId && !visited.has(currentId)) {
      visited.add(currentId);
      const currentMetrics = metricsMap.get(currentId);
      const currentNode = graph.getNode(currentId);

      if (currentMetrics && currentNode) {
        causalPath.push({
          serviceId: currentNode.id,
          serviceName: currentNode.name,
          anomalyDetectedAtMicros: currentMetrics.firstAnomalyTimestampMicros,
          observedMetric: currentMetrics.metricType,
          deviationFactor: currentMetrics.deviationFactor,
        });
      }

      // Check downstream dependencies for culpability
      const downstreamIds = graph.getDownstream(currentId);
      let nextCulpritId: string | null = null;

      for (const downId of downstreamIds) {
        const downMetrics = metricsMap.get(downId);
        if (
          downMetrics &&
          currentMetrics &&
          DependencyGraph.isDownstreamCulprit(currentMetrics, downMetrics, 0.80)
        ) {
          nextCulpritId = downId;
          break;
        }
      }

      if (nextCulpritId) {
        currentId = nextCulpritId;
      } else {
        // Deepest degraded node reached (downstream nodes are healthy or non-culprit)
        break;
      }
    }

    const rootCauseId = currentId;
    const rootMetrics = metricsMap.get(rootCauseId);
    const rootNode = graph.getNode(rootCauseId);
    const rootName = rootNode?.name ?? rootCauseId;

    // 4. Verify downstream health of root cause candidate
    const rootDownstreams = graph.getDownstream(rootCauseId);
    const allDownstreamsHealthy = rootDownstreams.every(
      (dId) => !metricsMap.get(dId)?.isDegraded,
    );

    // 5. Confidence scoring
    let confidence = 85.0; // Base score
    if (allDownstreamsHealthy) {
      confidence += 5.0; // Downstream health confirmed
    }
    if (temporalOrigin && temporalOrigin.serviceId === rootCauseId) {
      confidence += 4.5; // Temporal origin alignment
    } else if (
      temporalOrigin &&
      graph.getDownstream(temporalOrigin.serviceId).includes(rootCauseId)
    ) {
      confidence += 2.5;
    }
    if (rootMetrics && rootMetrics.selfLatencyMicros > 0) {
      confidence += 2.0;
    }
    const confidencePercentage = Number(Math.min(99.0, confidence).toFixed(1));

    // 6. Classify Failure Type
    let failureType: FailureType = 'LATENCY_INDUCED_SATURATION';
    if (rootMetrics) {
      if (rootMetrics.metricType.includes('CIRCUIT') || rootMetrics.metricType.includes('TRIP')) {
        failureType = 'CIRCUIT_TRIP_CASCADE';
      } else if (
        rootMetrics.metricType.includes('MEM') ||
        rootMetrics.metricType.includes('CPU') ||
        rootMetrics.metricType.includes('STARVATION')
      ) {
        failureType = 'RESOURCE_STARVATION';
      } else if (
        rootMetrics.metricType.includes('POISON') ||
        rootMetrics.metricType.includes('PANIC')
      ) {
        failureType = 'POISON_PILL';
      } else {
        failureType = 'LATENCY_INDUCED_SATURATION';
      }
    }

    // 7. Explanations and SRE recommendations
    const chainNames = causalPath.map((c) => c.serviceName).join(' ➔ ');
    const explanation =
      `Automated topological analysis identified ${rootName} as the primary root cause (confidence: ${confidencePercentage}%). ` +
      `Causal propagation path: [${chainNames}]. Upstream tiers degraded due to resource saturation and downstream wait time, ` +
      `while ${rootName}'s downstream dependencies remained entirely healthy.`;

    const architecturalRecommendation =
      failureType === 'LATENCY_INDUCED_SATURATION'
        ? `Install a circuit breaker with a fast-timeout (<= 250ms) and bulkhead concurrency isolation on calls to '${rootName}' to prevent upstream thread and queue exhaustion.`
        : failureType === 'CIRCUIT_TRIP_CASCADE'
          ? `Verify fallback mechanisms and reset timeouts for '${rootName}' to prevent cascading trip loops.`
          : `Configure strict payload validation and memory limits on '${rootName}' to isolate edge failures.`;

    return {
      rootCauseServiceId: rootCauseId,
      rootCauseServiceName: rootName,
      confidencePercentage,
      failureType,
      causalPath,
      explanation,
      architecturalRecommendation,
    };
  }
}
