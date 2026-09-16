import {
  NodeCircuitBreaker,
  RetryPolicyCore,
  DEADLINE_HEADER,
  DeadlineContext,
} from '@mirrorgrid/reliability';
import type { TraceContext } from './context.js';
import { formatTraceParent } from './context.js';

export interface DownstreamCallConfig {
  readonly targetUrl: string;
  readonly serviceName: string;
  readonly timeoutMs: number;
  readonly retryAttempts?: number;
}

export class RpcClient {
  private readonly breakers = new Map<string, NodeCircuitBreaker>();
  private readonly retryPolicy: RetryPolicyCore;

  constructor() {
    this.retryPolicy = new RetryPolicyCore({
      maxAttempts: 3,
      baseBackoffMicros: 25_000n, // 25ms
      maxBackoffMicros: 500_000n, // 500ms
      backoffJitter: 'FULL',
      retryableStatusCodes: new Set([502, 503, 504]),
      budget: {
        ttlMicros: 10_000_000n,
        minRetriesPerSec: 2,
        retryRatio: 0.1,
      },
    });
  }

  public getOrCreateBreaker(serviceName: string): NodeCircuitBreaker {
    let breaker = this.breakers.get(serviceName);
    if (!breaker) {
      breaker = new NodeCircuitBreaker({
        failureRateThresholdPpm: 500_000, // 50%
        volumeThreshold: 5,
        sleepWindowMicros: 5_000_000n, // 5s
        halfOpenMaxConcurrent: 2,
        consecutiveSuccessThreshold: 2,
        windowBucketCount: 10,
        bucketDurationMicros: 1_000_000n,
      });
      this.breakers.set(serviceName, breaker);
    }
    return breaker;
  }

  public async call(
    config: DownstreamCallConfig,
    traceCtx: TraceContext,
    deadlineCtx: DeadlineContext | null,
  ): Promise<{ status: number; body: unknown }> {
    const breaker = this.getOrCreateBreaker(config.serviceName);

    return breaker.execute(async () => {
      let attempt = 1;
      const maxAttempts = config.retryAttempts ?? 3;

      while (attempt <= maxAttempts) {
        const nowMicros = process.hrtime.bigint() / 1000n;

        // Check deadline before sending
        if (deadlineCtx && deadlineCtx.isExpired(nowMicros)) {
          const err = new Error('Deadline exceeded before outbound request');
          (err as { statusCode?: number }).statusCode = 504;
          throw err;
        }

        const headers: Record<string, string> = {
          'Content-Type': 'application/json',
          traceparent: formatTraceParent(traceCtx),
        };

        if (deadlineCtx) {
          headers[DEADLINE_HEADER] = DeadlineContext.format(deadlineCtx.deadlineAtMicros);
        }

        const controller = new AbortController();
        const timeout = setTimeout(() => controller.abort(), config.timeoutMs);

        try {
          const res = await fetch(config.targetUrl, {
            method: 'GET',
            headers,
            signal: controller.signal,
          });

          clearTimeout(timeout);

          if (res.ok) {
            const body = await res.json().catch(() => ({}));
            return { status: res.status, body };
          }

          // Error handling
          if (res.status >= 500) {
            const decision = this.retryPolicy.decide(
              attempt,
              res.status,
              nowMicros,
              Math.random(),
              deadlineCtx?.deadlineAtMicros,
            );

            if (decision.shouldRetry && attempt < maxAttempts) {
              const backoffMs = Number(decision.backoffMicros / 1000n);
              await new Promise((resolve) => setTimeout(resolve, backoffMs));
              attempt++;
              continue;
            }

            const err = new Error(`Downstream ${config.serviceName} returned status ${res.status}`);
            (err as { statusCode?: number }).statusCode = res.status;
            throw err;
          }

          const body = await res.json().catch(() => ({}));
          return { status: res.status, body };
        } catch (err: unknown) {
          clearTimeout(timeout);
          if (attempt >= maxAttempts) {
            throw err;
          }
          attempt++;
        }
      }

      throw new Error(`Failed to call ${config.serviceName} after ${maxAttempts} attempts`);
    });
  }
}
