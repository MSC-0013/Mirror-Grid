import { z } from 'zod';

export const createExperimentSchema = z.object({
  name: z.string().min(1).max(120),
  hypothesis: z.string().min(1),
  baselineDurationMicros: z.number().int().positive().default(30_000_000),
  faultDurationMicros: z.number().int().positive().default(30_000_000),
  cooldownDurationMicros: z.number().int().positive().default(15_000_000),
  faultSpecIds: z.array(z.string().uuid()).default([]),
  detectors: z
    .array(
      z.object({
        name: z.string(),
        detectorType: z.enum(['ERROR_RATE', 'P99_LATENCY', 'CIRCUIT_TRIPPED', 'QUEUE_SATURATION']),
        targetServiceId: z.string().uuid().optional(),
        targetEdgeId: z.string().uuid().optional(),
        thresholdValue: z.number(),
        windowDurationMicros: z.number().int().positive().default(5_000_000),
      }),
    )
    .default([]),
});

export const startExperimentSchema = z.object({
  runtimeMode: z.enum(['LOGICAL', 'CONTAINER', 'HYBRID']).default('LOGICAL'),
  seed: z.string().optional(),
});

export const abortExperimentSchema = z.object({
  reason: z.string().default('Operator manual abort'),
});

export type CreateExperimentDto = z.infer<typeof createExperimentSchema>;
export type StartExperimentDto = z.infer<typeof startExperimentSchema>;
export type AbortExperimentDto = z.infer<typeof abortExperimentSchema>;
