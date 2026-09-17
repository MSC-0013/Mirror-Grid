import { eq, type SQL } from 'drizzle-orm';
import type { MySqlTable } from 'drizzle-orm/mysql-core';
import { db } from './client.js';

/**
 * MySQL has no `RETURNING` clause.
 *
 * PostgreSQL and SQLite both let a write return the affected rows in one round trip;
 * MySQL does not, so every `insert(...).returning()` / `update(...).returning()` in the
 * codebase becomes a write followed by a read. These helpers make that explicit and
 * uniform rather than open-coding the pattern at 43 call sites.
 *
 * Cost: one extra round trip per mutation. Correctness note: the read is NOT atomic with
 * the write unless the caller wraps both in a transaction. For read-your-own-write inside
 * a request that is fine (same connection, same session). For anything where a concurrent
 * writer could interleave, wrap the pair in `db.transaction(...)`.
 */

/**
 * Insert one row and return it.
 *
 * The id is generated client-side so the row can be read back deterministically —
 * `LAST_INSERT_ID()` only works for AUTO_INCREMENT keys, and these tables use UUIDs.
 */
export async function insertReturning<TTable extends MySqlTable, TValues extends object>(
  table: TTable,
  values: TValues,
): Promise<TTable['$inferSelect']> {
  const idColumn = (table as unknown as { id?: unknown }).id;
  if (!idColumn) {
    throw new Error('insertReturning requires the table to have an `id` column');
  }

  const withId = values as TValues & { id?: string };
  const id = withId.id ?? crypto.randomUUID();

  await db.insert(table).values({ ...values, id } as never);

  const rows = await db
    .select()
    .from(table as unknown as MySqlTable)
    .where(eq(idColumn as never, id))
    .limit(1);

  const row = rows[0];
  if (!row) {
    throw new Error(`insertReturning: row ${id} not found immediately after insert`);
  }
  return row as TTable['$inferSelect'];
}

/** Insert many rows and return them, preserving input order. */
export async function insertManyReturning<TTable extends MySqlTable, TValues extends object>(
  table: TTable,
  values: TValues[],
): Promise<TTable['$inferSelect'][]> {
  const out: TTable['$inferSelect'][] = [];
  for (const value of values) {
    out.push(await insertReturning(table, value));
  }
  return out;
}

/**
 * Update rows matching `where` and return the first affected row, or null.
 *
 * Reads the id set BEFORE the update, so a change to a column used in `where`
 * (a status transition, for example) still returns the rows that were actually written.
 */
export async function updateReturning<TTable extends MySqlTable, TValues extends object>(
  table: TTable,
  values: TValues,
  where: SQL | undefined,
): Promise<TTable['$inferSelect'] | null> {
  const idColumn = (table as unknown as { id?: unknown }).id;
  if (!idColumn) {
    throw new Error('updateReturning requires the table to have an `id` column');
  }

  const targets = await db
    .select({ id: idColumn as never })
    .from(table as unknown as MySqlTable)
    .where(where)
    .limit(1);

  const target = targets[0] as { id: string } | undefined;
  if (!target) return null;

  await db
    .update(table)
    .set(values as never)
    .where(eq(idColumn as never, target.id));

  const rows = await db
    .select()
    .from(table as unknown as MySqlTable)
    .where(eq(idColumn as never, target.id))
    .limit(1);

  return (rows[0] as TTable['$inferSelect']) ?? null;
}

/** Read the row, delete it, return what was deleted — or null if it never existed. */
export async function deleteReturning<TTable extends MySqlTable>(
  table: TTable,
  where: SQL | undefined,
): Promise<TTable['$inferSelect'] | null> {
  const rows = await db
    .select()
    .from(table as unknown as MySqlTable)
    .where(where)
    .limit(1);

  const row = rows[0] as TTable['$inferSelect'] | undefined;
  if (!row) return null;

  await db.delete(table).where(where);
  return row;
}
