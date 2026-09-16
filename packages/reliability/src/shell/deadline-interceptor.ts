/**
 * DeadlineInterceptor: HTTP and RPC Deadline Propagation
 *
 * Extracts mg-deadline-at headers, creates DeadlineContext, and sheds calls
 * that have expired before invocation.
 */

import { DeadlineContext, DEADLINE_HEADER } from '../core/deadline.js';
import type { Clock } from '../core/types.js';
import { SystemClock } from './node-circuit-breaker.js';

export class DeadlineExceededError extends Error {
  public readonly code = 'DEADLINE_EXCEEDED';
  public readonly statusCode = 504;
  constructor(message = 'Operation deadline exceeded') {
    super(message);
    this.name = 'DeadlineExceededError';
  }
}

export class DeadlineInterceptor {
  private readonly clock: Clock;

  constructor(clock: Clock = new SystemClock()) {
    this.clock = clock;
  }

  /**
   * Inspects headers, parses mg-deadline-at, and verifies remaining time.
   * Throws DeadlineExceededError if expired or unserviceable.
   */
  public verify(
    headers: Record<string, string | string[] | undefined>,
    estimatedDownstreamLatencyMicros = 0n,
  ): DeadlineContext | null {
    const rawValue = headers[DEADLINE_HEADER] ?? headers[DEADLINE_HEADER.toLowerCase()];
    const ctx = DeadlineContext.parse(rawValue);

    if (!ctx) return null;

    const now = this.clock.nowMicros();

    if (ctx.isExpired(now)) {
      throw new DeadlineExceededError('Request deadline already expired before processing');
    }

    if (
      estimatedDownstreamLatencyMicros > 0n &&
      ctx.shouldShedPreemptively(now, estimatedDownstreamLatencyMicros)
    ) {
      throw new DeadlineExceededError(
        'Request deadline cannot be met based on expected service latency; shedding preemptively',
      );
    }

    return ctx;
  }

  /**
   * Injects mg-deadline-at header for an outgoing HTTP request.
   */
  public injectHeader(
    headers: Record<string, string>,
    timeoutMicros: bigint,
  ): Record<string, string> {
    const deadlineAt = this.clock.nowMicros() + timeoutMicros;
    headers[DEADLINE_HEADER] = DeadlineContext.format(deadlineAt);
    return headers;
  }
}
