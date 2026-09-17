import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import mysql from 'mysql2/promise';
import { config } from '@mirrorgrid/config';
import { parseDatabaseUrl } from './client.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

/**
 * Applies numbered .sql migrations in order, recording each in `_migrations`.
 *
 * Uses a single dedicated connection rather than the shared pool: `multipleStatements`
 * files and the applied-migrations ledger must run on the same session, and a migration
 * run should not compete with application traffic for pool slots.
 */
export async function runMigrations(connectionString = config.DATABASE_URL): Promise<void> {
  const parts = parseDatabaseUrl(connectionString);

  // Connect without selecting a database first, so a fresh server can be bootstrapped.
  const bootstrap = await mysql.createConnection({
    host: parts.host,
    port: parts.port,
    user: parts.user,
    password: parts.password,
    multipleStatements: true,
  });
  try {
    await bootstrap.query(
      `CREATE DATABASE IF NOT EXISTS \`${parts.database}\`
         CHARACTER SET utf8mb4 COLLATE utf8mb4_0900_ai_ci`,
    );
  } finally {
    await bootstrap.end();
  }

  const connection = await mysql.createConnection({
    ...parts,
    multipleStatements: true,
    timezone: 'Z',
    charset: 'utf8mb4',
  });

  try {
    console.log('Running database migrations...');

    await connection.query(`
      CREATE TABLE IF NOT EXISTS _migrations (
        id          BIGINT AUTO_INCREMENT PRIMARY KEY,
        name        VARCHAR(255) NOT NULL UNIQUE,
        applied_at  DATETIME(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6)
      ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;
    `);

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
      const [rows] = await connection.query<mysql.RowDataPacket[]>(
        'SELECT 1 FROM _migrations WHERE name = ?',
        [file],
      );

      if (rows.length > 0) {
        console.log(`- Migration ${file} (already applied)`);
        continue;
      }

      console.log(`Applying migration: ${file}...`);
      // Strip a UTF-8 BOM: some editors save with one, and mysql2's multi-statement
      // parser treats it as the start of an invalid identifier on the first statement
      // rather than silently ignoring it (unlike libsql, which tolerated it).
      const content = fs
        .readFileSync(path.join(migrationsDir, file), 'utf8')
        .replace(/^﻿/, '');

      // MySQL DDL is not transactional — an ALTER commits implicitly — so a failure
      // mid-file leaves partial state. Record the failing file loudly rather than
      // marking it applied and letting the next run skip a half-applied migration.
      try {
        await connection.query(content);
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        throw new Error(
          `Migration ${file} failed: ${msg}\n` +
            'MySQL DDL is not transactional, so this database may be partially migrated. ' +
            'Drop and recreate it rather than re-running against dirty state.',
        );
      }

      await connection.query('INSERT INTO _migrations (name) VALUES (?)', [file]);
      console.log(`  Applied ${file}`);
    }

    console.log('All migrations applied successfully.');
  } finally {
    await connection.end();
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
