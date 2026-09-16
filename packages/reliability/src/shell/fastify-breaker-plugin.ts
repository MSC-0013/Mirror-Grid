/**
 * Fastify Breaker Hook / Interceptor
 *
 * Provides a hook function for Fastify servers to enforce circuit breaker
 * admission checks before dispatching to downstream dependencies.
 *
 * Structurally typed so packages/reliability has ZERO runtime dependencies.
 */

import type { CircuitBreakerCore } from '../core/circuit-breaker.js';
import type { Clock } from '../core/types.js';

export interface FastifyLikeRequest {
  headers: Record<string, string | string[] | undefined>;
  url?: string;
  method?: string;
}

export interface FastifyLikeReply {
  status(statusCode: number): this;
  send(payload: unknown): this;
}

export function createBreakerPreHandler(breaker: CircuitBreakerCore, clock: Clock) {
  return async function preHandler(
    _req: FastifyLikeRequest,
    reply: FastifyLikeReply,
  ): Promise<void> {
    const now = clock.nowMicros();
    const result = breaker.tryAcquire(now);

    if (!result.allowed) {
      reply.status(503).send({
        error: {
          code: 'CIRCUIT_OPEN',
          message: 'Circuit breaker is OPEN or half-open concurrency cap exceeded',
          reason: result.reason,
        },
      });
    }
  };
}
