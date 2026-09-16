import { z } from 'zod';
import { uuidSchema } from '@mirrorgrid/validation';

export const createRunSchema = z.object({
  worldId: uuidSchema,
  seed: z
    .union([z.number(), z.string(), z.bigint()])
    .default(42)
    .transform((v) => BigInt(v)),
  runtimeMode: z.enum(['LOGICAL', 'CONTAINER', 'HYBRID']).default('LOGICAL'),
  driver: z.enum(['FAST', 'REALTIME']).default('FAST'),
  durationMs: z.number().int().positive().default(10000),
  baseRate: z.number().int().positive().default(200),
  pattern: z
    .enum(['CONSTANT', 'RAMP_UP', 'RAMP_DOWN', 'BURST', 'SPIKE', 'RANDOM'])
    .default('CONSTANT'),
});

export const runIdParamSchema = z.object({
  id: uuidSchema,
});

export const getMetricsQuerySchema = z.object({
  serviceId: uuidSchema.optional(),
  fromUs: z
    .string()
    .optional()
    .transform((v) => (v ? BigInt(v) : undefined)),
  toUs: z
    .string()
    .optional()
    .transform((v) => (v ? BigInt(v) : undefined)),
});

export type CreateRunInput = z.infer<typeof createRunSchema>;
