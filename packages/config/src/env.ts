import { z } from 'zod';
import { existsSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

/**
 * Load the repo-root .env file into process.env, if one exists.
 *
 * Nothing did this before: every package read process.env directly, so a developer's
 * .env was silently decorative and every value actually came from the zod defaults
 * below. That is how the MySQL port remap (3306 -> 3307) went unnoticed for an entire
 * debugging cycle -- .env said 3307, the code still ran on the stale in-source default
 * baked into a compiled packages/config/dist/env.js that nobody had rebuilt.
 *
 * Walks up from this module's own location rather than assuming a cwd, since turbo runs
 * each workspace script with that package's directory as cwd (e.g. packages/db), not the
 * repo root -- a relative process.loadEnvFile('.env') would never find it from there.
 * Existing process.env values always win: loadEnvFile() does not overwrite a variable a
 * real shell or container environment already set, which is what makes this safe in
 * production, where there is no .env file and everything comes from real env vars.
 */
function loadRepoEnvFile(): void {
  let dir = dirname(fileURLToPath(import.meta.url));
  for (let i = 0; i < 8; i++) {
    const candidate = join(dir, '.env');
    if (existsSync(candidate)) {
      process.loadEnvFile(candidate);
      return;
    }
    const parent = dirname(dir);
    if (parent === dir) break; // reached filesystem root
    dir = parent;
  }
}

loadRepoEnvFile();

export const envSchema = z.object({
  NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
  DATABASE_URL: z.string().default('mysql://mirrorgrid:mirrorgrid@localhost:3307/mirrorgrid'),
  GATEWAY_PORT: z.coerce.number().int().positive().default(4000),
  CONTROL_PORT: z.coerce.number().int().positive().default(4001),
  SIMULATION_PORT: z.coerce.number().int().positive().default(4002),
  WEB_PORT: z.coerce.number().int().positive().default(3000),
  SESSION_SECRET: z
    .string()
    .min(32)
    .default('dev_session_secret_change_in_production_min_32_chars_long'),
  LOG_LEVEL: z.enum(['fatal', 'error', 'warn', 'info', 'debug', 'trace']).default('info'),
});

export type AppConfig = z.infer<typeof envSchema>;

export function loadConfig(rawEnv: Record<string, string | undefined> = process.env): AppConfig {
  const result = envSchema.safeParse(rawEnv);
  if (!result.success) {
    const formatted = result.error.format();
    throw new Error(`Configuration validation error: ${JSON.stringify(formatted, null, 2)}`);
  }
  return Object.freeze(result.data);
}

export const config: AppConfig = loadConfig();
