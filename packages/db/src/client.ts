import { drizzle } from 'drizzle-orm/postgres-js';
import postgres from 'postgres';
import * as schema from './schema/index.js';
import { config } from '@mirrorgrid/config';

const connectionString = config.DATABASE_URL;

// Connection pool for normal operations
export const queryClient = postgres(connectionString, {
  max: 10,
  idle_timeout: 20,
  connect_timeout: 10,
});

export const db = drizzle(queryClient, { schema });
export type Database = typeof db;
