import { drizzle } from 'drizzle-orm/libsql';
import { createClient, type Client } from '@libsql/client';
import fs from 'node:fs';
import path from 'node:path';
import * as schema from './schema/index.js';
import { config } from '@mirrorgrid/config';

export function resolveDatabaseUrl(rawUrl = config.DATABASE_URL): string {
  if (!rawUrl || rawUrl === ':memory:') {
    return ':memory:';
  }
  if (rawUrl.startsWith('file:')) {
    const rawPath = rawUrl.slice(5);
    const resolvedPath = path.resolve(process.cwd(), rawPath);
    const dir = path.dirname(resolvedPath);
    if (!fs.existsSync(dir)) {
      fs.mkdirSync(dir, { recursive: true });
    }
    return `file:${resolvedPath.replace(/\\/g, '/')}`;
  }
  return rawUrl;
}

export const queryClient: Client = createClient({
  url: resolveDatabaseUrl(),
});

export const db = drizzle(queryClient, { schema });
export type Database = typeof db;
