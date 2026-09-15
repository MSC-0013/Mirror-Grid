import { eq, and } from 'drizzle-orm';
import { db, schema } from '@mirrorgrid/db';
import type { CreateWorkloadInput, UpdateWorkloadInput } from './workloads.schema.js';

export class WorkloadsRepository {
  public async findByWorldId(worldId: string) {
    return db
      .select()
      .from(schema.workloads)
      .where(eq(schema.workloads.worldId, worldId))
      .orderBy(schema.workloads.createdAt);
  }

  public async findById(worldId: string, id: string) {
    const rows = await db
      .select()
      .from(schema.workloads)
      .where(and(eq(schema.workloads.worldId, worldId), eq(schema.workloads.id, id)))
      .limit(1);

    return rows[0] || null;
  }

  public async findByName(worldId: string, name: string) {
    const rows = await db
      .select()
      .from(schema.workloads)
      .where(and(eq(schema.workloads.worldId, worldId), eq(schema.workloads.name, name)))
      .limit(1);

    return rows[0] || null;
  }

  public async create(worldId: string, input: CreateWorkloadInput) {
    const [created] = await db
      .insert(schema.workloads)
      .values({
        worldId,
        name: input.name,
        targetServiceId: input.targetServiceId,
        pattern: input.pattern,
        baseRate: input.baseRate.toString(),
        peakRate: input.peakRate !== undefined ? input.peakRate.toString() : null,
        durationMs: input.durationMs !== undefined ? BigInt(input.durationMs) : null,
        config: input.config || {},
      })
      .returning();

    return created;
  }

  public async update(worldId: string, id: string, input: UpdateWorkloadInput) {
    const updateValues: Record<string, unknown> = {
      updatedAt: new Date(),
    };

    if (input.name !== undefined) updateValues.name = input.name;
    if (input.targetServiceId !== undefined) updateValues.targetServiceId = input.targetServiceId;
    if (input.pattern !== undefined) updateValues.pattern = input.pattern;
    if (input.baseRate !== undefined) updateValues.baseRate = input.baseRate.toString();
    if (input.peakRate !== undefined) updateValues.peakRate = input.peakRate.toString();
    if (input.durationMs !== undefined) updateValues.durationMs = BigInt(input.durationMs);
    if (input.config !== undefined) updateValues.config = input.config;

    const [updated] = await db
      .update(schema.workloads)
      .set(updateValues)
      .where(and(eq(schema.workloads.worldId, worldId), eq(schema.workloads.id, id)))
      .returning();

    return updated || null;
  }

  public async delete(worldId: string, id: string) {
    const [deleted] = await db
      .delete(schema.workloads)
      .where(and(eq(schema.workloads.worldId, worldId), eq(schema.workloads.id, id)))
      .returning();

    return deleted || null;
  }
}
