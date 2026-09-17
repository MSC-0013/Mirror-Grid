import { eq, and, count } from 'drizzle-orm';
import { db, schema, updateReturning, deleteReturning } from '@mirrorgrid/db';
import type { CreateServiceInput, UpdateServiceInput } from './services.schema.js';

export class ServicesRepository {
  public async findByWorldId(worldId: string, page = 1, limit = 50) {
    const offset = (page - 1) * limit;

    const [items, totalResult] = await Promise.all([
      db
        .select()
        .from(schema.services)
        .where(eq(schema.services.worldId, worldId))
        .limit(limit)
        .offset(offset)
        .orderBy(schema.services.createdAt),
      db
        .select({ value: count() })
        .from(schema.services)
        .where(eq(schema.services.worldId, worldId)),
    ]);

    return {
      items,
      total: Number(totalResult[0]?.value ?? 0),
    };
  }

  public async findById(worldId: string, id: string) {
    const rows = await db
      .select()
      .from(schema.services)
      .where(and(eq(schema.services.worldId, worldId), eq(schema.services.id, id)))
      .limit(1);

    return rows[0] || null;
  }

  public async findByName(worldId: string, name: string) {
    const rows = await db
      .select()
      .from(schema.services)
      .where(and(eq(schema.services.worldId, worldId), eq(schema.services.name, name)))
      .limit(1);

    return rows[0] || null;
  }

  public async create(worldId: string, input: CreateServiceInput) {
    return db.transaction(async (tx) => {
      // Written inline against `tx` rather than through insertReturning(): that helper
      // always reads back via the pool's `db`, which is a DIFFERENT connection than the
      // transaction. Reading back through the pool here would see nothing (the insert
      // isn't committed yet) or, worse, would let the service row appear to callers
      // outside this transaction before the instance rows are written alongside it.
      const id = crypto.randomUUID();
      await tx.insert(schema.services).values({
        id,
        worldId,
        name: input.name,
        description: input.description,
        serviceType: input.serviceType,
        targetInstances: input.targetInstances,
        concurrencyLimit: input.concurrencyLimit,
        queueCapacity: input.queueCapacity,
        config: input.config || {},
      });
      const [service] = await tx
        .select()
        .from(schema.services)
        .where(eq(schema.services.id, id))
        .limit(1);

      // Automatically create initial service instances
      const instanceRows = [];
      for (let i = 0; i < input.targetInstances; i++) {
        instanceRows.push({
          serviceId: service.id,
          worldId,
          instanceIndex: i,
          status: 'STOPPED',
        });
      }

      if (instanceRows.length > 0) {
        await tx.insert(schema.serviceInstances).values(instanceRows);
      }

      return service;
    });
  }

  public async update(worldId: string, id: string, input: UpdateServiceInput) {
    return updateReturning(
      schema.services,
      { ...input, updatedAt: new Date() },
      and(eq(schema.services.worldId, worldId), eq(schema.services.id, id)),
    );
  }

  public async delete(worldId: string, id: string) {
    return deleteReturning(
      schema.services,
      and(eq(schema.services.worldId, worldId), eq(schema.services.id, id)),
    );
  }

  public async countDependents(serviceId: string): Promise<number> {
    const result = await db
      .select({ value: count() })
      .from(schema.serviceDependencies)
      .where(eq(schema.serviceDependencies.targetServiceId, serviceId));

    return Number(result[0]?.value ?? 0);
  }

  public async getInstances(serviceId: string) {
    return db
      .select()
      .from(schema.serviceInstances)
      .where(eq(schema.serviceInstances.serviceId, serviceId))
      .orderBy(schema.serviceInstances.instanceIndex);
  }
}
