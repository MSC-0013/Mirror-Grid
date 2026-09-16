import { AppError } from '@mirrorgrid/platform';
import { isValidServiceTransition, type ServiceStatus } from '@mirrorgrid/domain';
import { ServicesRepository } from './services.repository.js';
import type { CreateServiceInput, UpdateServiceInput } from './services.schema.js';

export class ServicesService {
  constructor(private readonly repo: ServicesRepository = new ServicesRepository()) {}

  public async listServices(worldId: string, page = 1, limit = 50) {
    return this.repo.findByWorldId(worldId, page, limit);
  }

  public async getService(worldId: string, id: string) {
    const service = await this.repo.findById(worldId, id);
    if (!service) {
      throw AppError.notFound('Service', id);
    }
    const instances = await this.repo.getInstances(id);
    return {
      ...service,
      instances,
    };
  }

  public async createService(worldId: string, input: CreateServiceInput) {
    const existing = await this.repo.findByName(worldId, input.name);
    if (existing) {
      throw AppError.conflict(`A Service named '${input.name}' already exists in this World`);
    }

    return this.repo.create(worldId, input);
  }

  public async updateService(worldId: string, id: string, input: UpdateServiceInput) {
    const current = await this.repo.findById(worldId, id);
    if (!current) {
      throw AppError.notFound('Service', id);
    }

    if (input.name && input.name !== current.name) {
      const existing = await this.repo.findByName(worldId, input.name);
      if (existing) {
        throw AppError.conflict(`A Service named '${input.name}' already exists in this World`);
      }
    }

    if (input.status && input.status !== current.status) {
      if (
        !isValidServiceTransition(current.status as ServiceStatus, input.status as ServiceStatus)
      ) {
        throw AppError.badRequest(
          `Invalid service status transition from '${current.status}' to '${input.status}'`,
        );
      }
    }

    const updated = await this.repo.update(worldId, id, input);
    if (!updated) {
      throw AppError.notFound('Service', id);
    }
    return updated;
  }

  public async deleteService(worldId: string, id: string) {
    const service = await this.repo.findById(worldId, id);
    if (!service) {
      throw AppError.notFound('Service', id);
    }

    // Invariant §115.2: Deleting a service with dependents must return 409
    const dependentCount = await this.repo.countDependents(id);
    if (dependentCount > 0) {
      throw AppError.conflict(
        `Cannot delete Service '${service.name}' because ${dependentCount} dependent(s) rely on it.`,
      );
    }

    await this.repo.delete(worldId, id);
  }
}
