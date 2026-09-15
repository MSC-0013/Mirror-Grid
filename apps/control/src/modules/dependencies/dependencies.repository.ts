import { eq, and } from 'drizzle-orm';
import { db, schema } from '@mirrorgrid/db';
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
        and(
          eq(schema.serviceDependencies.worldId, worldId),
          eq(schema.serviceDependencies.id, id)
        )
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
          eq(schema.serviceDependencies.targetServiceId, targetServiceId)
        )
      )
      .limit(1);

    return rows[0] || null;
  }

  public async create(worldId: string, input: CreateDependencyInput) {
    const [created] = await db
      .insert(schema.serviceDependencies)
      .values({
        worldId,
        sourceServiceId: input.sourceServiceId,
        targetServiceId: input.targetServiceId,
        timeoutMs: input.timeoutMs,
        criticality: input.criticality,
        retryPolicy: input.retryPolicy,
        circuitBreakerPolicy: input.circuitBreakerPolicy,
      })
      .returning();

    return created;
  }

  public async update(worldId: string, id: string, input: UpdateDependencyInput) {
    const [updated] = await db
      .update(schema.serviceDependencies)
      .set({
        ...input,
        updatedAt: new Date(),
      })
      .where(
        and(
          eq(schema.serviceDependencies.worldId, worldId),
          eq(schema.serviceDependencies.id, id)
        )
      )
      .returning();

    return updated || null;
  }

  public async delete(worldId: string, id: string) {
    const [deleted] = await db
      .delete(schema.serviceDependencies)
      .where(
        and(
          eq(schema.serviceDependencies.worldId, worldId),
          eq(schema.serviceDependencies.id, id)
        )
      )
      .returning();

    return deleted || null;
  }

  public async getServicesInWorld(worldId: string) {
    return db
      .select({ id: schema.services.id, name: schema.services.name })
      .from(schema.services)
      .where(eq(schema.services.worldId, worldId));
  }
}
