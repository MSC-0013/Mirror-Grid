import { z } from 'zod';

export interface EventHeaders {
  readonly correlationId: string;
  readonly causationId?: string;
  readonly actorId?: string;
  readonly actorEmail?: string;
}

export const EventHeadersSchema = z.object({
  correlationId: z.string(),
  causationId: z.string().optional(),
  actorId: z.string().optional(),
  actorEmail: z.string().optional(),
});

export interface DomainEventEnvelope<T = unknown> {
  readonly id: string;
  readonly worldId: string;
  readonly aggregateType: string;
  readonly aggregateId: string;
  readonly eventType: string;
  readonly partitionKey: string;
  readonly sequenceNum: number;
  readonly payload: T;
  readonly headers: EventHeaders;
  readonly timestamp: Date;
}

export const DomainEventEnvelopeSchema = z.object({
  id: z.string().uuid(),
  worldId: z.string().uuid(),
  aggregateType: z.string().min(1),
  aggregateId: z.string().min(1),
  eventType: z.string().min(1),
  partitionKey: z.string().min(1),
  sequenceNum: z.number().int().nonnegative(),
  payload: z.record(z.string(), z.unknown()),
  headers: EventHeadersSchema,
  timestamp: z.date(),
});
