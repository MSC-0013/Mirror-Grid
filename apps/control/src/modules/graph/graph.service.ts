import { DependencyGraph, detectCycles, criticalPath } from '@mirrorgrid/domain';
import { ServicesRepository } from '../services/services.repository.js';
import { DependenciesRepository } from '../dependencies/dependencies.repository.js';

export class GraphService {
  constructor(
    private readonly servicesRepo: ServicesRepository = new ServicesRepository(),
    private readonly depsRepo: DependenciesRepository = new DependenciesRepository()
  ) {}

  public async getGraph(worldId: string) {
    const [{ items: services }, dependencies] = await Promise.all([
      this.servicesRepo.findByWorldId(worldId, 1, 1000),
      this.depsRepo.findByWorldId(worldId),
    ]);

    const graph = new DependencyGraph(services.map((s) => s.id));
    for (const dep of dependencies) {
      graph.addEdge(dep.sourceServiceId, dep.targetServiceId);
    }

    const cycle = detectCycles(graph);
    const hasCycles = cycle !== null;

    let criticalPathLength = 0;
    if (!hasCycles && services.length > 0) {
      const sources = services.filter((s) => graph.getIncoming(s.id).length === 0);
      const sinks = services.filter((s) => graph.getOutgoing(s.id).length === 0);

      for (const src of sources) {
        for (const snk of sinks) {
          const path = criticalPath(graph, src.id, snk.id);
          if (path.length > criticalPathLength) {
            criticalPathLength = path.length;
          }
        }
      }

      if (criticalPathLength === 0 && services.length > 0) {
        criticalPathLength = 1;
      }
    }

    return {
      services,
      dependencies,
      metrics: {
        serviceCount: services.length,
        edgeCount: dependencies.length,
        hasCycles,
        criticalPathLength,
      },
    };
  }
}
