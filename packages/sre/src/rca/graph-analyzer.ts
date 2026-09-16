/**
 * Dependency graph analysis and topological culpability transfer.
 */

export interface GraphNode {
  readonly id: string;
  readonly name: string;
}

export interface GraphEdge {
  readonly sourceId: string;
  readonly targetId: string;
}

export interface NodeMetrics {
  readonly serviceId: string;
  readonly serviceName: string;
  readonly isDegraded: boolean;
  readonly firstAnomalyTimestampMicros: number;
  readonly totalLatencyMicros: number;
  readonly selfLatencyMicros: number;
  readonly errorCount: number;
  readonly requestCount: number;
  readonly metricType: string;
  readonly deviationFactor: number;
}

export class DependencyGraph {
  private readonly nodes = new Map<string, GraphNode>();
  private readonly downstream = new Map<string, Set<string>>(); // source -> targets
  private readonly upstream = new Map<string, Set<string>>(); // target -> sources

  constructor(nodes: readonly GraphNode[], edges: readonly GraphEdge[]) {
    for (const node of nodes) {
      this.nodes.set(node.id, node);
      this.downstream.set(node.id, new Set());
      this.upstream.set(node.id, new Set());
    }

    for (const edge of edges) {
      this.downstream.get(edge.sourceId)?.add(edge.targetId);
      this.upstream.get(edge.targetId)?.add(edge.sourceId);
    }
  }

  getNode(id: string): GraphNode | undefined {
    return this.nodes.get(id);
  }

  getDownstream(id: string): readonly string[] {
    return Array.from(this.downstream.get(id) ?? []);
  }

  getUpstream(id: string): readonly string[] {
    return Array.from(this.upstream.get(id) ?? []);
  }

  /**
   * Identifies entry point nodes in the topology (nodes with 0 upstream callers).
   */
  getEntrypoints(): readonly GraphNode[] {
    const entrypoints: GraphNode[] = [];
    for (const [id, sources] of this.upstream.entries()) {
      if (sources.size === 0) {
        const node = this.nodes.get(id);
        if (node) entrypoints.push(node);
      }
    }
    return entrypoints;
  }

  /**
   * Finds all paths between sourceId and targetId.
   */
  findPaths(sourceId: string, targetId: string): string[][] {
    const results: string[][] = [];
    const visited = new Set<string>();

    const dfs = (current: string, path: string[]) => {
      if (current === targetId) {
        results.push([...path, current]);
        return;
      }
      visited.add(current);
      const nextNodes = this.downstream.get(current) ?? new Set();
      for (const next of nextNodes) {
        if (!visited.has(next)) {
          dfs(next, [...path, current]);
        }
      }
      visited.delete(current);
    };

    dfs(sourceId, []);
    return results;
  }

  /**
   * Evaluates culpability transfer along edge (A -> B).
   * If downstream node B's execution time accounts for >= 85% of upstream node A's latency,
   * culpability shifts to B.
   */
  static isDownstreamCulprit(
    upstream: NodeMetrics,
    downstream: NodeMetrics,
    culpabilityThreshold: number = 0.85,
  ): boolean {
    if (!downstream.isDegraded) {
      return false;
    }
    // If upstream latency is dominated by downstream latency
    if (upstream.totalLatencyMicros > 0) {
      const downstreamShare = downstream.totalLatencyMicros / upstream.totalLatencyMicros;
      if (downstreamShare >= culpabilityThreshold) {
        return true;
      }
    }
    // If downstream threw errors and upstream threw 502/504/timeout
    if (downstream.errorCount > 0) {
      return true;
    }
    return false;
  }
}
