import { z } from 'zod';
import { uuidSchema } from '@mirrorgrid/validation';

export const serviceTypeEnum = z.enum([
  'HTTP',
  'GRPC',
  'WORKER',
  'DATABASE',
  'CACHE',
  'MESSAGE_BROKER',
]);

export const serviceStatusEnum = z.enum([
  'STOPPED',
  'STARTING',
  'HEALTHY',
  'DEGRADED',
  'PARTIALLY_AVAILABLE',
  'UNHEALTHY',
  'FAILED',
  'UNKNOWN',
]);

export const createServiceSchema = z.object({
  name: z.string().min(1).max(64).regex(/^[a-zA-Z0-9_-]+$/, 'Service name must contain only letters, numbers, underscores, or hyphens'),
  description: z.string().max(256).optional(),
  serviceType: serviceTypeEnum.default('HTTP'),
  targetInstances: z.number().int().min(1).max(100).default(1),
  concurrencyLimit: z.number().int().min(1).default(64),
  queueCapacity: z.number().int().min(0).default(1000),
  config: z.record(z.string(), z.unknown()).default({}),
});

export const updateServiceSchema = z.object({
  name: z.string().min(1).max(64).regex(/^[a-zA-Z0-9_-]+$/).optional(),
  description: z.string().max(256).optional(),
  serviceType: serviceTypeEnum.optional(),
  status: serviceStatusEnum.optional(),
  targetInstances: z.number().int().min(1).max(100).optional(),
  concurrencyLimit: z.number().int().min(1).optional(),
  queueCapacity: z.number().int().min(0).optional(),
  config: z.record(z.string(), z.unknown()).optional(),
});

export const serviceWorldParamSchema = z.object({
  worldId: uuidSchema,
});

export const serviceParamSchema = z.object({
  worldId: uuidSchema,
  serviceId: uuidSchema,
});

export type CreateServiceInput = z.infer<typeof createServiceSchema>;
export type UpdateServiceInput = z.infer<typeof updateServiceSchema>;
