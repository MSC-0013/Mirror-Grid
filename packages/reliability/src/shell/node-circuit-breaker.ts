/**
 * NodeCircuitBreaker: Async Shell Adapter
 *
 * Wraps CircuitBreakerCore with asynchronous execution handling,
 * error boundary capture, and clock injection.
 */

import { CircuitBreakerCore } from '../core/circuit-breaker.js';
import type { CircuitBreakerConfig, CircuitBreakerTransition, Clock } from '../core/types.js';

export class SystemClock implements Clock {
  public nowMicros(): bigint {
    return process.hrtime.bigint() / 1000n;
  }
}

export class CircuitBreakerOpenError extends Error {
  public readonly code = 'CIRCUIT_OPEN';
  constructor(message = 'Circuit breaker is OPEN; request rejected immediately') {
    super(message);
    this.name = 'CircuitBreakerOpenError';
  }
}

export class NodeCircuitBreaker {
  public readonly core: CircuitBreakerCore;
  private readonly clock: Clock;
  private readonly onTransition?: (t: CircuitBreakerTransition) => void;

  constructor(
    config: CircuitBreakerConfig,
    clock: Clock = new SystemClock(),
    onTransition?: (t: CircuitBreakerTransition) => void,
  ) {
    this.clock = clock;
    this.core = new CircuitBreakerCore(config, this.clock.nowMicros());
    this.onTransition = onTransition;
  }

  public get state() {
    return this.core.state;
  }

  public get failureRatePpm() {
    return this.core.failureRatePpm;
  }

  public async execute<T>(fn: () => Promise<T>): Promise<T> {
    const now = this.clock.nowMicros();
    const admission = this.core.tryAcquire(now);

    if (!admission.allowed) {
      throw new CircuitBreakerOpenError();
    }

    try {
      const result = await fn();
      const transitions = this.core.recordSuccess(this.clock.nowMicros());
      for (const t of transitions) {
        this.onTransition?.(t);
      }
      return result;
    } catch (err) {
      const transitions = this.core.recordFailure(this.clock.nowMicros());
      for (const t of transitions) {
        this.onTransition?.(t);
      }
      throw err;
    }
  }

  public trip(reason = 'MANUAL_OVERRIDE'): CircuitBreakerTransition {
    const t = this.core.trip(this.clock.nowMicros(), reason);
    this.onTransition?.(t);
    return t;
  }

  public reset(): CircuitBreakerTransition {
    const t = this.core.reset(this.clock.nowMicros());
    this.onTransition?.(t);
    return t;
  }
}
