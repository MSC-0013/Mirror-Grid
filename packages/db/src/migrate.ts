import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import postgres from 'postgres';
import { config } from '@mirrorgrid/config';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

export async function runMigrations(connectionString = config.DATABASE_URL) {
  const sql = postgres(connectionString, { max: 1 });

  try {
    console.log('Running database migrations...');
    // Create migrations table if not exists
    await sql`
      CREATE TABLE IF NOT EXISTS _migrations (
        id SERIAL PRIMARY KEY,
        name TEXT NOT NULL UNIQUE,
        applied_at TIMESTAMPTZ NOT NULL DEFAULT now()
      );
    `;

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
      const alreadyApplied = await sql`
        SELECT 1 FROM _migrations WHERE name = ${file}
      `;

      if (alreadyApplied.length > 0) {
        console.log(`- Migration ${file} (already applied)`);
        continue;
      }

      console.log(`Applying migration: ${file}...`);
      const filePath = path.join(migrationsDir, file);
      const content = fs.readFileSync(filePath, 'utf8');

      await sql.begin(async (tx) => {
        await tx.unsafe(content);
        await tx`INSERT INTO _migrations (name) VALUES (${file})`;
      });

      console.log(`✓ Applied ${file}`);
    }

    console.log('All migrations applied successfully.');
  } finally {
    await sql.end();
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
