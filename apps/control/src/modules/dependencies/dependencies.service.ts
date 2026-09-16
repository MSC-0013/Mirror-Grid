import { AppError } from '@mirrorgrid/platform';
import { DependencyGraph, detectCycles } from '@mirrorgrid/domain';
import { DependenciesRepository } from './dependencies.repository.js';
import type { CreateDependencyInput, UpdateDependencyInput } from './dependencies.schema.js';

export class DependenciesService {
  constructor(private readonly repo: DependenciesRepository = new DependenciesRepository()) {}

  public async listDependencies(worldId: string) {
    return this.repo.findByWorldId(worldId);
  }

  public async getDependency(worldId: string, id: string) {
    const dep = await this.repo.findById(worldId, id);
    if (!dep) {
      throw AppError.notFound('Dependency', id);
    }
    return dep;
  }

  public async createDependency(worldId: string, input: CreateDependencyInput) {
    // 1. Prevent self-edges
    if (input.sourceServiceId === input.targetServiceId) {
      throw AppError.badRequest(
        'Self-edges are not allowed: source and target service must differ',
      );
    }

    // 2. Verify both services exist within this world
    const services = await this.repo.getServicesInWorld(worldId);
    const serviceMap = new Map(services.map((s) => [s.id, s.name]));

    if (!serviceMap.has(input.sourceServiceId)) {
      throw AppError.badRequest(
        `Source service '${input.sourceServiceId}' does not belong to this World`,
      );
    }
    if (!serviceMap.has(input.targetServiceId)) {
      throw AppError.badRequest(
        `Target service '${input.targetServiceId}' does not belong to this World`,
      );
    }

    // 3. Check for existing duplicate edge
    const existing = await this.repo.findByEndpoints(
      worldId,
      input.sourceServiceId,
      input.targetServiceId,
    );
    if (existing) {
      throw AppError.conflict('A dependency between these services already exists');
    }

    // 4. Construct speculative graph to assert DAG property (no cycles)
    const currentDeps = await this.repo.findByWorldId(worldId);
    const graph = new DependencyGraph(services.map((s) => s.id));

    for (const dep of currentDeps) {
      graph.addEdge(dep.sourceServiceId, dep.targetServiceId);
    }
    graph.addEdge(input.sourceServiceId, input.targetServiceId);

    // 5. Run Cycle Detection algorithm
    const cycle = detectCycles(graph);
    if (cycle) {
      const cycleNames = cycle.services.map((id) => serviceMap.get(id) || id);
      throw AppError.unprocessable(`Cycle detected: ${cycleNames.join(' -> ')}`, {
        cycle: cycleNames,
        cyclePath: cycleNames,
        cycleIds: cycle.services,
      });
    }

    // 6. Safe to commit
    return this.repo.create(worldId, input);
  }

  public async updateDependency(worldId: string, id: string, input: UpdateDependencyInput) {
    const current = await this.repo.findById(worldId, id);
    if (!current) {
      throw AppError.notFound('Dependency', id);
    }

    const updated = await this.repo.update(worldId, id, input);
    if (!updated) {
      throw AppError.notFound('Dependency', id);
    }
    return updated;
  }

  public async deleteDependency(worldId: string, id: string) {
    const current = await this.repo.findById(worldId, id);
    if (!current) {
      throw AppError.notFound('Dependency', id);
    }

    await this.repo.delete(worldId, id);
  }
}
