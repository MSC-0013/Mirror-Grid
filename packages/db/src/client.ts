import { drizzle, type MySql2Database } from 'drizzle-orm/mysql2';
import mysql, { type Pool } from 'mysql2/promise';
import * as schema from './schema/index.js';
import { config } from '@mirrorgrid/config';

export interface MySqlConnectionParts {
  host: string;
  port: number;
  user: string;
  password: string;
  database: string;
}

/**
 * Parse a `mysql://user:pass@host:port/database` URL into pool options.
 *
 * Kept explicit rather than handing the URL straight to mysql2 so that a malformed
 * DATABASE_URL fails here with a clear message, rather than as an opaque connection
 * error on first query.
 */
export function parseDatabaseUrl(rawUrl = config.DATABASE_URL): MySqlConnectionParts {
  let url: URL;
  try {
    url = new URL(rawUrl);
  } catch {
    throw new Error(
      `DATABASE_URL is not a valid URL: "${rawUrl}". ` +
        'Expected mysql://user:password@host:port/database',
    );
  }

  if (url.protocol !== 'mysql:') {
    throw new Error(
      `DATABASE_URL must use the mysql:// protocol, got "${url.protocol}". ` +
        'MIRRORGRID uses MySQL 8.4 as its single database (see docs/adr/006).',
    );
  }

  const database = url.pathname.replace(/^\//, '');
  if (!database) {
    throw new Error(`DATABASE_URL is missing a database name: "${rawUrl}"`);
  }

  return {
    host: url.hostname || '127.0.0.1',
    port: url.port ? Number(url.port) : 3306,
    user: decodeURIComponent(url.username) || 'root',
    password: decodeURIComponent(url.password),
    database,
  };
}

export function createPool(rawUrl = config.DATABASE_URL): Pool {
  const parts = parseDatabaseUrl(rawUrl);
  return mysql.createPool({
    ...parts,
    connectionLimit: 10,
    waitForConnections: true,
    // Migrations execute multi-statement .sql files in one round trip.
    multipleStatements: true,
    // All timestamps in this schema are epoch integers, but any DATETIME that appears
    // later must not be silently shifted by the host's local zone.
    timezone: 'Z',
    // BIGINT columns (event_seq, virtual_time_us, seed) exceed Number.MAX_SAFE_INTEGER.
    // Return them as JS numbers where safe and strings where not, so precision is never
    // silently lost — the caller converts to BigInt explicitly.
    supportBigNumbers: true,
    bigNumberStrings: false,
    dateStrings: false,
    charset: 'utf8mb4',
  });
}

export const queryClient: Pool = createPool();

export const db: MySql2Database<typeof schema> = drizzle(queryClient, {
  schema,
  mode: 'default',
});

export type Database = typeof db;

/** Close the pool. Called from graceful-shutdown paths and at the end of gate scripts. */
export async function closeDatabase(): Promise<void> {
  await queryClient.end();
}
