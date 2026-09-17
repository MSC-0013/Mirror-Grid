import { eq, and } from 'drizzle-orm';
import { db, schema, insertReturning, updateReturning, deleteReturning } from '@mirrorgrid/db';
import type { CreateDependencyInput, UpdateDependencyInput } from './dependencies.schema.js';

export class DependenciesRepository {
  public async findByWorldId(worldId: string) {
    return db
      .select()
      .from(schema.serviceDependencies)
      .where(eq(schema.serviceDependencies.worldId, worldId))
      .orderBy(schema.serviceDependencies.createdAt);
  }

  public async findById(worldId: string, id: string) {
    const rows = await db
      .select()
      .from(schema.serviceDependencies)
      .where(
        and(eq(schema.serviceDependencies.worldId, worldId), eq(schema.serviceDependencies.id, id)),
      )
      .limit(1);

    return rows[0] || null;
  }

  public async findByEndpoints(worldId: string, sourceServiceId: string, targetServiceId: string) {
    const rows = await db
      .select()
      .from(schema.serviceDependencies)
      .where(
        and(
          eq(schema.serviceDependencies.worldId, worldId),
          eq(schema.serviceDependencies.sourceServiceId, sourceServiceId),
          eq(schema.serviceDependencies.targetServiceId, targetServiceId),
        ),
      )
      .limit(1);

    return rows[0] || null;
  }

  public async create(worldId: string, input: CreateDependencyInput) {
    return insertReturning(schema.serviceDependencies, {
      worldId,
      sourceServiceId: input.sourceServiceId,
      targetServiceId: input.targetServiceId,
      timeoutMs: input.timeoutMs,
      criticality: input.criticality,
      retryPolicy: input.retryPolicy,
      circuitBreakerPolicy: input.circuitBreakerPolicy,
    });
  }

  public async update(worldId: string, id: string, input: UpdateDependencyInput) {
    return updateReturning(
      schema.serviceDependencies,
      { ...input, updatedAt: new Date() },
      and(eq(schema.serviceDependencies.worldId, worldId), eq(schema.serviceDependencies.id, id)),
    );
  }

  public async delete(worldId: string, id: string) {
    return deleteReturning(
      schema.serviceDependencies,
      and(eq(schema.serviceDependencies.worldId, worldId), eq(schema.serviceDependencies.id, id)),
    );
  }

  public async getServicesInWorld(worldId: string) {
    return db
      .select({ id: schema.services.id, name: schema.services.name })
      .from(schema.services)
      .where(eq(schema.services.worldId, worldId));
  }
}
