import type { ServiceId } from './types.js';

export interface EdgeMetadata {
  timeoutMs?: number;
  criticality?: string;
  weight?: number;
}

export class DependencyGraph {
  private readonly nodes: Set<ServiceId> = new Set();
  private readonly outgoing: Map<ServiceId, Set<ServiceId>> = new Map();
  private readonly incoming: Map<ServiceId, Set<ServiceId>> = new Map();
  private readonly edgeData: Map<string, EdgeMetadata> = new Map();

  constructor(nodeIds: ServiceId[] = []) {
    for (const id of nodeIds) {
      this.addNode(id);
    }
  }

  public addNode(id: ServiceId): this {
    this.nodes.add(id);
    if (!this.outgoing.has(id)) {
      this.outgoing.set(id, new Set());
    }
    if (!this.incoming.has(id)) {
      this.incoming.set(id, new Set());
    }
    return this;
  }

  public removeNode(id: ServiceId): boolean {
    if (!this.nodes.has(id)) return false;
    this.nodes.delete(id);

    // Remove outgoing edges from this node
    const outTargets = this.outgoing.get(id) || new Set();
    for (const target of outTargets) {
      this.incoming.get(target)?.delete(id);
      this.edgeData.delete(`${id}->${target}`);
    }
    this.outgoing.delete(id);

    // Remove incoming edges to this node
    const inSources = this.incoming.get(id) || new Set();
    for (const source of inSources) {
      this.outgoing.get(source)?.delete(id);
      this.edgeData.delete(`${source}->${id}`);
    }
    this.incoming.delete(id);

    return true;
  }

  public addEdge(source: ServiceId, target: ServiceId, metadata?: EdgeMetadata): this {
    this.addNode(source);
    this.addNode(target);

    this.outgoing.get(source)!.add(target);
    this.incoming.get(target)!.add(source);

    if (metadata) {
      this.edgeData.set(`${source}->${target}`, metadata);
    }
    return this;
  }

  public removeEdge(source: ServiceId, target: ServiceId): boolean {
    const hasOut = this.outgoing.get(source)?.delete(target) ?? false;
    this.incoming.get(target)?.delete(source);
    this.edgeData.delete(`${source}->${target}`);
    return hasOut;
  }

  public hasNode(id: ServiceId): boolean {
    return this.nodes.has(id);
  }

  public hasEdge(source: ServiceId, target: ServiceId): boolean {
    return this.outgoing.get(source)?.has(target) ?? false;
  }

  public getNodes(): ServiceId[] {
    return Array.from(this.nodes);
  }

  public getNodeCount(): number {
    return this.nodes.size;
  }

  public getEdgeCount(): number {
    let count = 0;
    for (const targets of this.outgoing.values()) {
      count += targets.size;
    }
    return count;
  }

  public getOutgoing(id: ServiceId): ServiceId[] {
    return Array.from(this.outgoing.get(id) || []);
  }

  public getIncoming(id: ServiceId): ServiceId[] {
    return Array.from(this.incoming.get(id) || []);
  }

  public getEdgeMetadata(source: ServiceId, target: ServiceId): EdgeMetadata | undefined {
    return this.edgeData.get(`${source}->${target}`);
  }

  public clone(): DependencyGraph {
    const copy = new DependencyGraph(this.getNodes());
    for (const [source, targets] of this.outgoing.entries()) {
      for (const target of targets) {
        copy.addEdge(source, target, this.edgeData.get(`${source}->${target}`));
      }
    }
    return copy;
  }
}
