import { z } from 'zod';

export const tripBreakerSchema = z.object({
  reason: z.string().default('MANUAL_OPERATOR_TRIP'),
});

export const resetBreakerSchema = z.object({
  reason: z.string().default('MANUAL_OPERATOR_RESET'),
});

export type TripBreakerInput = z.infer<typeof tripBreakerSchema>;
export type ResetBreakerInput = z.infer<typeof resetBreakerSchema>;
