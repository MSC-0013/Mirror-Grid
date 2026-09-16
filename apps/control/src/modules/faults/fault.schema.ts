import { z } from 'zod';

export const createFaultSpecSchema = z.object({
  name: z.string().min(1).max(120),
  description: z.string().optional(),
  faultType: z.enum([
    'LATENCY',
    'ERROR',
    'PACKET_DROP',
    'JITTER',
    'BLACKHOLE',
    'BANDWIDTH_LIMIT',
    'CORRUPT_PAYLOAD',
    'SERVICE_KILL',
  ]),
  targetServiceId: z.string().uuid().optional(),
  targetEdgeId: z.string().uuid().optional(),
  parameters: z.record(z.string(), z.unknown()).default({}),
  safetyRules: z
    .object({
      maxDurationMicros: z.number().int().positive().default(300_000_000), // 5 min default
      autoAbortOnBurnRate: z.boolean().default(true),
    })
    .default({
      maxDurationMicros: 300_000_000,
      autoAbortOnBurnRate: true,
    }),
});

export const injectFaultSchema = z.object({
  durationMicros: z.number().int().positive().default(60_000_000), // 1 min default
});

export const emergencyAbortSchema = z.object({
  reason: z.string().default('MANUAL_OPERATOR_ABORT'),
});

export type CreateFaultSpecInput = z.infer<typeof createFaultSpecSchema>;
export type InjectFaultInput = z.infer<typeof injectFaultSchema>;
export type EmergencyAbortInput = z.infer<typeof emergencyAbortSchema>;
