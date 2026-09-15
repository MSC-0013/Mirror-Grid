import { AppError } from '@mirrorgrid/platform';
import { WorkloadsRepository } from './workloads.repository.js';
import { ServicesRepository } from '../services/services.repository.js';
import type { CreateWorkloadInput, UpdateWorkloadInput } from './workloads.schema.js';

export class WorkloadsService {
  constructor(
    private readonly repo: WorkloadsRepository = new WorkloadsRepository(),
    private readonly servicesRepo: ServicesRepository = new ServicesRepository()
  ) {}

  public async listWorkloads(worldId: string) {
    return this.repo.findByWorldId(worldId);
  }

  public async getWorkload(worldId: string, id: string) {
    const workload = await this.repo.findById(worldId, id);
    if (!workload) {
      throw AppError.notFound('Workload', id);
    }
    return workload;
  }

  public async createWorkload(worldId: string, input: CreateWorkloadInput) {
    // 1. Check target service exists in world
    const targetService = await this.servicesRepo.findById(worldId, input.targetServiceId);
    if (!targetService) {
      throw AppError.unprocessable(`Target service '${input.targetServiceId}' does not belong to this World`);
    }

    // 2. Check name uniqueness within this world
    const existing = await this.repo.findByName(worldId, input.name);
    if (existing) {
      throw AppError.conflict(`A Workload named '${input.name}' already exists in this World`);
    }

    return this.repo.create(worldId, input);
  }

  public async updateWorkload(worldId: string, id: string, input: UpdateWorkloadInput) {
    const current = await this.repo.findById(worldId, id);
    if (!current) {
      throw AppError.notFound('Workload', id);
    }

    if (input.targetServiceId && input.targetServiceId !== current.targetServiceId) {
      const targetService = await this.servicesRepo.findById(worldId, input.targetServiceId);
      if (!targetService) {
        throw AppError.unprocessable(`Target service '${input.targetServiceId}' does not belong to this World`);
      }
    }

    if (input.name && input.name !== current.name) {
      const existing = await this.repo.findByName(worldId, input.name);
      if (existing) {
        throw AppError.conflict(`A Workload named '${input.name}' already exists in this World`);
      }
    }

    const updated = await this.repo.update(worldId, id, input);
    if (!updated) {
      throw AppError.notFound('Workload', id);
    }
    return updated;
  }

  public async deleteWorkload(worldId: string, id: string) {
    const current = await this.repo.findById(worldId, id);
    if (!current) {
      throw AppError.notFound('Workload', id);
    }

    await this.repo.delete(worldId, id);
  }
}
