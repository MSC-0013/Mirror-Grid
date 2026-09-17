export { db, queryClient, parseDatabaseUrl, createPool, closeDatabase } from './client.js';
export type { Database, MySqlConnectionParts } from './client.js';
export { runMigrations } from './migrate.js';
export { DbHealthProbe } from './health.js';
export {
  insertReturning,
  insertManyReturning,
  updateReturning,
  deleteReturning,
} from './returning.js';
export * as schema from './schema/index.js';
export * from './schema/index.js';
export { eq, and, or, sql, desc, asc, count, gte, lte, gt, lt } from 'drizzle-orm';
