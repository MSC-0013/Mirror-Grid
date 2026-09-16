import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createClient } from '@libsql/client';
import { config } from '@mirrorgrid/config';
import { resolveDatabaseUrl } from './client.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

export async function runMigrations(connectionString = config.DATABASE_URL) {
  const url = resolveDatabaseUrl(connectionString);
  const client = createClient({ url });

  try {
    console.log('Running database migrations...');
    // Create migrations table if not exists
    await client.execute(`
      CREATE TABLE IF NOT EXISTS _migrations (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        name TEXT NOT NULL UNIQUE,
        applied_at TEXT NOT NULL DEFAULT (datetime('now'))
      );
    `);

    // Enable foreign keys in SQLite
    await client.execute('PRAGMA foreign_keys = ON;');

    // Locate migrations dir (handles both src and dist contexts)
    let migrationsDir = path.join(__dirname, 'migrations');
    if (!fs.existsSync(migrationsDir)) {
      migrationsDir = path.join(__dirname, '..', 'src', 'migrations');
    }

    if (!fs.existsSync(migrationsDir)) {
      throw new Error(`Migrations directory not found at ${migrationsDir}`);
    }

    const files = fs
      .readdirSync(migrationsDir)
      .filter((f) => f.endsWith('.sql'))
      .sort();

    for (const file of files) {
      const checkRes = await client.execute({
        sql: 'SELECT 1 FROM _migrations WHERE name = ?',
        args: [file],
      });

      if (checkRes.rows.length > 0) {
        console.log(`- Migration ${file} (already applied)`);
        continue;
      }

      console.log(`Applying migration: ${file}...`);
      const filePath = path.join(migrationsDir, file);
      const content = fs.readFileSync(filePath, 'utf8');

      // Execute SQL content
      try {
        await client.executeMultiple(content);
      } catch (err: unknown) {
        const msg = err instanceof Error ? err.message : String(err);
        if (msg.includes('duplicate column name')) {
          console.log(`  (tolerated duplicate column in ${file})`);
        } else {
          throw err;
        }
      }

      await client.execute({
        sql: 'INSERT INTO _migrations (name) VALUES (?)',
        args: [file],
      });

      console.log(`✓ Applied ${file}`);
    }

    console.log('All migrations applied successfully.');
  } finally {
    client.close();
  }
}

// If executed directly via CLI
if (process.argv[1] === __filename) {
  runMigrations()
    .then(() => process.exit(0))
    .catch((err) => {
      console.error('Migration failed:', err);
      process.exit(1);
    });
}
