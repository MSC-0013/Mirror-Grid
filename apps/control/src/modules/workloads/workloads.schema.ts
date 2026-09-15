import { z } from 'zod';
import { uuidSchema } from '@mirrorgrid/validation';

export const workloadPatternEnum = z.enum([
  'CONSTANT',
  'RAMP_UP',
  'RAMP_DOWN',
  'BURST',
  'SPIKE',
  'RANDOM',
]);

export const createWorkloadSchema = z.object({
  name: z.string().min(1).max(64),
  targetServiceId: uuidSchema,
  pattern: workloadPatternEnum.default('CONSTANT'),
  baseRate: z.number().min(0),
  peakRate: z.number().min(0).optional(),
  durationMs: z.number().int().min(100).optional(),
  config: z.record(z.string(), z.unknown()).default({}),
});

export const updateWorkloadSchema = z.object({
  name: z.string().min(1).max(64).optional(),
  targetServiceId: uuidSchema.optional(),
  pattern: workloadPatternEnum.optional(),
  baseRate: z.number().min(0).optional(),
  peakRate: z.number().min(0).optional(),
  durationMs: z.number().int().min(100).optional(),
  config: z.record(z.string(), z.unknown()).optional(),
});

export const workloadWorldParamSchema = z.object({
  worldId: uuidSchema,
});

export const workloadParamSchema = z.object({
  worldId: uuidSchema,
  id: uuidSchema,
});

export type CreateWorkloadInput = z.infer<typeof createWorkloadSchema>;
export type UpdateWorkloadInput = z.infer<typeof updateWorkloadSchema>;
