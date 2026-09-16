import type { SpanData } from './span-collector.js';

export interface TraceWaterfallNode extends SpanData {
  readonly depth: number;
  readonly offsetPercent: number;
  readonly widthPercent: number;
  readonly isCriticalPath: boolean;
  readonly children: TraceWaterfallNode[];
}

export interface TraceDetail {
  readonly traceId: string;
  readonly totalDurationMicros: number;
  readonly spanCount: number;
  readonly serviceCount: number;
  readonly rootSpan: TraceWaterfallNode;
  readonly hasError: boolean;
}

export class TraceWaterfallBuilder {
  /**
   * Reconstructs a hierarchical waterfall tree from a list of out-of-order flat spans.
   */
  public static buildWaterfall(spans: readonly SpanData[]): TraceDetail {
    if (spans.length === 0) {
      throw new Error('Cannot build waterfall from empty spans list');
    }

    const spanMap = new Map<string, SpanData>();
    const childrenMap = new Map<string, SpanData[]>();
    const distinctServices = new Set<string>();
    let hasError = false;

    for (const span of spans) {
      spanMap.set(span.spanId, span);
      distinctServices.add(span.serviceName);
      if (span.statusCode === 'ERROR') {
        hasError = true;
      }

      if (span.parentSpanId) {
        const list = childrenMap.get(span.parentSpanId) ?? [];
        list.push(span);
        childrenMap.set(span.parentSpanId, list);
      }
    }

    // Identify root span: span without parent or whose parent is not in this trace
    let rootSpanData = spans.find(
      (s) => !s.parentSpanId || !spanMap.has(s.parentSpanId),
    );

    if (!rootSpanData) {
      // Fallback: span with earliest start time
      rootSpanData = [...spans].sort((a, b) => a.startTimeMicros - b.startTimeMicros)[0];
    }

    const rootStart = rootSpanData.startTimeMicros;
    // Calculate total trace duration from earliest start to latest end
    let maxEndTime = rootStart + rootSpanData.durationMicros;
    for (const s of spans) {
      maxEndTime = Math.max(maxEndTime, s.startTimeMicros + s.durationMicros);
    }
    const totalDuration = Math.max(1, maxEndTime - rootStart);

    // Identify Critical Path: find path from root to leaf maximizing cumulative duration
    const criticalSpanIds = this.findCriticalPath(rootSpanData, childrenMap);

    // Recursively build tree nodes
    const rootNode = this.buildNode(
      rootSpanData,
      0,
      rootStart,
      totalDuration,
      childrenMap,
      criticalSpanIds,
    );

    return {
      traceId: rootSpanData.traceId,
      totalDurationMicros: totalDuration,
      spanCount: spans.length,
      serviceCount: distinctServices.size,
      rootSpan: rootNode,
      hasError,
    };
  }

  private static buildNode(
    span: SpanData,
    depth: number,
    rootStart: number,
    totalDuration: number,
    childrenMap: Map<string, SpanData[]>,
    criticalSpanIds: Set<string>,
  ): TraceWaterfallNode {
    const rawOffset = ((span.startTimeMicros - rootStart) / totalDuration) * 100;
    const offsetPercent = Math.min(100, Math.max(0, Number(rawOffset.toFixed(2))));

    const rawWidth = (span.durationMicros / totalDuration) * 100;
    const widthPercent = Math.min(100, Math.max(0.5, Number(rawWidth.toFixed(2))));

    const isCriticalPath = criticalSpanIds.has(span.spanId);

    const rawChildren = childrenMap.get(span.spanId) ?? [];
    // Sort children chronologically by startTimeMicros
    rawChildren.sort((a, b) => a.startTimeMicros - b.startTimeMicros);

    const children = rawChildren.map((child) =>
      this.buildNode(child, depth + 1, rootStart, totalDuration, childrenMap, criticalSpanIds),
    );

    return {
      ...span,
      depth,
      offsetPercent,
      widthPercent,
      isCriticalPath,
      children,
    };
  }

  private static findCriticalPath(
    root: SpanData,
    childrenMap: Map<string, SpanData[]>,
  ): Set<string> {
    const criticalSet = new Set<string>();

    function dfs(current: SpanData): { maxDuration: number; path: string[] } {
      const children = childrenMap.get(current.spanId) ?? [];

      if (children.length === 0) {
        return { maxDuration: current.durationMicros, path: [current.spanId] };
      }

      let bestChildDuration = -1;
      let bestSubPath: string[] = [];

      for (const child of children) {
        const sub = dfs(child);
        if (sub.maxDuration > bestChildDuration) {
          bestChildDuration = sub.maxDuration;
          bestSubPath = sub.path;
        }
      }

      return {
        maxDuration: current.durationMicros + Math.max(0, bestChildDuration),
        path: [current.spanId, ...bestSubPath],
      };
    }

    const { path } = dfs(root);
    for (const id of path) {
      criticalSet.add(id);
    }
    return criticalSet;
  }
}
