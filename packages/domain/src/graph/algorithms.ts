import type { DependencyGraph } from './graph.js';
import type { ServiceId, CyclePath } from './types.js';

/**
 * Detects directed cycles in the dependency graph using 3-color DFS.
 * Returns the cycle path if found, or null if the graph is a DAG.
 */
export function detectCycles(graph: DependencyGraph): CyclePath | null {
  const nodes = graph.getNodes();
  // 0: Unvisited (White), 1: Visiting (Gray), 2: Visited (Black)
  const color = new Map<ServiceId, number>();
  for (const node of nodes) {
    color.set(node, 0);
  }

  const stack: ServiceId[] = [];
  let detectedCycle: ServiceId[] | null = null;

  function dfs(curr: ServiceId): boolean {
    color.set(curr, 1);
    stack.push(curr);

    const neighbors = graph.getOutgoing(curr);
    for (const next of neighbors) {
      const neighborColor = color.get(next) ?? 0;
      if (neighborColor === 1) {
        // Cycle found!
        const cycleStartIndex = stack.indexOf(next);
        if (cycleStartIndex !== -1) {
          detectedCycle = [...stack.slice(cycleStartIndex), next];
          return true;
        }
      } else if (neighborColor === 0) {
        if (dfs(next)) {
          return true;
        }
      }
    }

    stack.pop();
    color.set(curr, 2);
    return false;
  }

  for (const node of nodes) {
    if (color.get(node) === 0) {
      if (dfs(node)) {
        return { services: detectedCycle! };
      }
    }
  }

  return null;
}

/**
 * Computes topological ordering of services using Kahn's algorithm.
 * Throws an Error if a cycle exists.
 */
export function topologicalOrder(graph: DependencyGraph): ServiceId[] {
  const nodes = graph.getNodes();
  const inDegree = new Map<ServiceId, number>();

  for (const node of nodes) {
    inDegree.set(node, 0);
  }

  for (const node of nodes) {
    for (const target of graph.getOutgoing(node)) {
      inDegree.set(target, (inDegree.get(target) || 0) + 1);
    }
  }

  const queue: ServiceId[] = [];
  for (const [node, deg] of inDegree.entries()) {
    if (deg === 0) {
      queue.push(node);
    }
  }

  const result: ServiceId[] = [];
  while (queue.length > 0) {
    const current = queue.shift()!;
    result.push(current);

    for (const neighbor of graph.getOutgoing(current)) {
      const newDeg = (inDegree.get(neighbor) || 1) - 1;
      inDegree.set(neighbor, newDeg);
      if (newDeg === 0) {
        queue.push(neighbor);
      }
    }
  }

  if (result.length !== nodes.length) {
    throw new Error('Graph contains a cycle; topological order cannot be computed');
  }

  return result;
}

/**
 * Finds all upstream services capable of reaching `serviceId`.
 * For root-cause analysis and blast radius attribution.
 * e.g. in Gateway -> Orders -> Payments, reachableFrom('payments') returns { 'orders', 'gateway' }.
 */
export function reachableFrom(graph: DependencyGraph, serviceId: ServiceId): Set<ServiceId> {
  const result = new Set<ServiceId>();
  const visited = new Set<ServiceId>([serviceId]);
  const queue: ServiceId[] = [serviceId];

  while (queue.length > 0) {
    const current = queue.shift()!;
    const callers = graph.getIncoming(current);
    for (const caller of callers) {
      if (!visited.has(caller)) {
        visited.add(caller);
        result.add(caller);
        queue.push(caller);
      }
    }
  }

  return result;
}

/**
 * Finds all downstream dependents of `serviceId` along directed edges.
 * If `serviceId` fails, these services may be affected.
 */
export function dependentsOf(graph: DependencyGraph, serviceId: ServiceId): Set<ServiceId> {
  const result = new Set<ServiceId>();
  const visited = new Set<ServiceId>([serviceId]);
  const queue: ServiceId[] = [serviceId];

  while (queue.length > 0) {
    const current = queue.shift()!;
    const targets = graph.getOutgoing(current);
    for (const target of targets) {
      if (!visited.has(target)) {
        visited.add(target);
        result.add(target);
        queue.push(target);
      }
    }
  }

  return result;
}

/**
 * Computes the critical (longest) path between `start` and `end` in a DAG.
 */
export function criticalPath(
  graph: DependencyGraph,
  start: ServiceId,
  end: ServiceId,
): ServiceId[] {
  if (start === end) {
    return [start];
  }

  const memo = new Map<ServiceId, ServiceId[] | null>();

  function findLongest(current: ServiceId): ServiceId[] | null {
    if (current === end) {
      return [end];
    }
    if (memo.has(current)) {
      return memo.get(current)!;
    }

    let longestSubPath: ServiceId[] | null = null;
    const neighbors = graph.getOutgoing(current);

    for (const next of neighbors) {
      const pathFromNext = findLongest(next);
      if (pathFromNext !== null) {
        if (longestSubPath === null || pathFromNext.length > longestSubPath.length) {
          longestSubPath = pathFromNext;
        }
      }
    }

    const fullPath = longestSubPath !== null ? [current, ...longestSubPath] : null;
    memo.set(current, fullPath);
    return fullPath;
  }

  const result = findLongest(start);
  return result || [];
}
