import { z } from 'zod';

export const WorldStatusEnum = z.enum([
  'IDLE',
  'CONFIGURING',
  'READY',
  'RUNNING',
  'PAUSED',
  'STOPPING',
  'STOPPED',
  'FAILED',
  'ARCHIVED',
]);

export const RuntimeModeEnum = z.enum(['LOGICAL', 'CONTAINER', 'HYBRID']);

export const createWorldSchema = z.object({
  name: z.string().min(1).max(100),
  description: z.string().max(500).optional(),
  runtimeMode: RuntimeModeEnum.default('LOGICAL'),
});

export const updateWorldSchema = z.object({
  name: z.string().min(1).max(100).optional(),
  description: z.string().max(500).optional(),
  status: WorldStatusEnum.optional(),
  runtimeMode: RuntimeModeEnum.optional(),
});

export const worldParamSchema = z.object({
  id: z.string().uuid(),
});

export type CreateWorldInput = z.infer<typeof createWorldSchema>;
export type UpdateWorldInput = z.infer<typeof updateWorldSchema>;
