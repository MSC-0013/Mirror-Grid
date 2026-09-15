import { AppError } from '@mirrorgrid/platform';
import { WorldsRepository } from './worlds.repository.js';
import type { CreateWorldInput, UpdateWorldInput } from './worlds.schema.js';

const VALID_TRANSITIONS: Record<string, string[]> = {
  IDLE: ['CONFIGURING', 'READY', 'ARCHIVED'],
  CONFIGURING: ['READY', 'IDLE', 'ARCHIVED'],
  READY: ['RUNNING', 'IDLE', 'ARCHIVED'],
  RUNNING: ['PAUSED', 'STOPPING', 'FAILED'],
  PAUSED: ['RUNNING', 'STOPPING', 'ARCHIVED'],
  STOPPING: ['STOPPED', 'FAILED'],
  STOPPED: ['READY', 'ARCHIVED', 'IDLE'],
  FAILED: ['IDLE', 'ARCHIVED'],
  ARCHIVED: [],
};

export class WorldsService {
  constructor(private readonly repo: WorldsRepository = new WorldsRepository()) {}

  public async listWorlds(organizationId: string, page = 1, limit = 20) {
    return this.repo.listWorlds(organizationId, page, limit);
  }

  public async getWorld(organizationId: string, id: string) {
    const world = await this.repo.findById(organizationId, id);
    if (!world) {
      throw AppError.notFound('World', id);
    }
    return world;
  }

  public async createWorld(
    organizationId: string,
    createdBy: string,
    input: CreateWorldInput
  ) {
    const existing = await this.repo.findByName(organizationId, input.name);
    if (existing) {
      throw AppError.conflict(`A World named '${input.name}' already exists in this organization`);
    }

    return this.repo.createWorld(organizationId, createdBy, input);
  }

  public async updateWorld(
    organizationId: string,
    id: string,
    input: UpdateWorldInput
  ) {
    const current = await this.getWorld(organizationId, id);

    if (input.name && input.name !== current.name) {
      const existing = await this.repo.findByName(organizationId, input.name);
      if (existing) {
        throw AppError.conflict(`A World named '${input.name}' already exists in this organization`);
      }
    }

    if (input.status && input.status !== current.status) {
      const allowed = VALID_TRANSITIONS[current.status] || [];
      if (!allowed.includes(input.status)) {
        throw AppError.badRequest(
          `Invalid status transition from '${current.status}' to '${input.status}'. Allowed transitions: [${allowed.join(', ')}]`
        );
      }
    }

    const updated = await this.repo.updateWorld(organizationId, id, input);
    if (!updated) {
      throw AppError.notFound('World', id);
    }
    return updated;
  }

  public async deleteWorld(organizationId: string, id: string) {
    const world = await this.getWorld(organizationId, id);
    if (world.status === 'RUNNING') {
      throw AppError.badRequest('Cannot delete a running World. Stop or pause it first.');
    }
    await this.repo.deleteWorld(organizationId, id);
  }
}
