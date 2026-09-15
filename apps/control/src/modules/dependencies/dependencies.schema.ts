import { z } from 'zod';
import { uuidSchema } from '@mirrorgrid/validation';

export const criticalityEnum = z.enum(['REQUIRED', 'OPTIONAL', 'BEST_EFFORT']);

export const retryPolicySchema = z.object({
  type: z.enum(['EXPONENTIAL', 'CONSTANT', 'NONE']).default('EXPONENTIAL'),
  maxAttempts: z.number().int().min(0).max(10).default(3),
  baseDelayMs: z.number().int().min(1).default(100),
  maxDelayMs: z.number().int().min(1).default(30000),
  jitterFactor: z.number().min(0).max(1).default(0.25),
  budgetPercent: z.number().min(0).max(100).default(20),
});

export const circuitBreakerPolicySchema = z.object({
  enabled: z.boolean().default(true),
  threshold: z.number().int().min(1).default(5),
  windowMs: z.number().int().min(100).default(10000),
  cooldownMs: z.number().int().min(100).default(30000),
  halfOpenProbes: z.number().int().min(1).default(3),
});

export const createDependencySchema = z.object({
  sourceServiceId: uuidSchema,
  targetServiceId: uuidSchema,
  timeoutMs: z.number().int().min(1).default(5000),
  criticality: criticalityEnum.default('REQUIRED'),
  retryPolicy: retryPolicySchema.default({
    type: 'EXPONENTIAL',
    maxAttempts: 3,
    baseDelayMs: 100,
    maxDelayMs: 30000,
    jitterFactor: 0.25,
    budgetPercent: 20,
  }),
  circuitBreakerPolicy: circuitBreakerPolicySchema.default({
    enabled: true,
    threshold: 5,
    windowMs: 10000,
    cooldownMs: 30000,
    halfOpenProbes: 3,
  }),
});

export const updateDependencySchema = z.object({
  timeoutMs: z.number().int().min(1).optional(),
  criticality: criticalityEnum.optional(),
  retryPolicy: retryPolicySchema.optional(),
  circuitBreakerPolicy: circuitBreakerPolicySchema.optional(),
});

export const dependencyWorldParamSchema = z.object({
  worldId: uuidSchema,
});

export const dependencyParamSchema = z.object({
  worldId: uuidSchema,
  id: uuidSchema,
});

export type CreateDependencyInput = z.infer<typeof createDependencySchema>;
export type UpdateDependencyInput = z.infer<typeof updateDependencySchema>;
