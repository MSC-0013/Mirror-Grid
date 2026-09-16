import { z } from 'zod';

export const envSchema = z.object({
  NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
  DATABASE_URL: z.string().default('postgres://postgres:postgres@localhost:5432/mirrorgrid'),
  GATEWAY_PORT: z.coerce.number().int().positive().default(4000),
  CONTROL_PORT: z.coerce.number().int().positive().default(4001),
  SIMULATION_PORT: z.coerce.number().int().positive().default(4002),
  WEB_PORT: z.coerce.number().int().positive().default(3000),
  SESSION_SECRET: z.string().min(32).default('dev_session_secret_change_in_production_min_32_chars_long'),
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
