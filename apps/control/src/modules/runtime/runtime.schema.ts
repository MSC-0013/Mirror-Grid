import { z } from 'zod';

export const deployRuntimeSchema = z.object({
  runtimeMode: z.enum(['LOGICAL', 'CONTAINER', 'HYBRID']).default('CONTAINER'),
  cpuLimitCores: z.number().positive().default(1.0),
  memoryLimitMb: z.number().int().positive().default(256),
});

export type DeployRuntimeInput = z.infer<typeof deployRuntimeSchema>;
