import { eq, and, desc, count } from 'drizzle-orm';
import { db, insertReturning, updateReturning } from '@mirrorgrid/db';
import { worlds } from '@mirrorgrid/db/schema';
import type { CreateWorldInput, UpdateWorldInput } from './worlds.schema.js';

export class WorldsRepository {
  public async listWorlds(organizationId: string, page = 1, limit = 20) {
    const offset = (page - 1) * limit;

    const [items, totalResult] = await Promise.all([
      db
        .select()
        .from(worlds)
        .where(eq(worlds.organizationId, organizationId))
        .orderBy(desc(worlds.createdAt))
        .limit(limit)
        .offset(offset),
      db.select({ total: count() }).from(worlds).where(eq(worlds.organizationId, organizationId)),
    ]);

    const total = totalResult[0]?.total ?? 0;
    return { items, total };
  }

  public async findById(organizationId: string, id: string) {
    const result = await db
      .select()
      .from(worlds)
      .where(and(eq(worlds.organizationId, organizationId), eq(worlds.id, id)))
      .limit(1);

    return result[0] || null;
  }

  public async findByName(organizationId: string, name: string) {
    const result = await db
      .select()
      .from(worlds)
      .where(and(eq(worlds.organizationId, organizationId), eq(worlds.name, name)))
      .limit(1);

    return result[0] || null;
  }

  public async createWorld(organizationId: string, createdBy: string, input: CreateWorldInput) {
    return insertReturning(worlds, {
      organizationId,
      createdBy,
      name: input.name,
      description: input.description,
      runtimeMode: input.runtimeMode,
      status: 'IDLE',
      eventSeq: 0n,
    });
  }

  public async updateWorld(organizationId: string, id: string, input: UpdateWorldInput) {
    return updateReturning(
      worlds,
      { ...input, updatedAt: new Date() },
      and(eq(worlds.organizationId, organizationId), eq(worlds.id, id)),
    );
  }

  public async deleteWorld(organizationId: string, id: string) {
    // Only a boolean is needed here, so read affectedRows off the delete itself
    // rather than doing an extra pre-read for a row the caller never uses.
    const [result] = await db
      .delete(worlds)
      .where(and(eq(worlds.organizationId, organizationId), eq(worlds.id, id)));

    return result.affectedRows > 0;
  }
}
