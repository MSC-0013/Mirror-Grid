import assert from 'node:assert';
import type { RuntimeAdapter, WorldSpec } from '@mirrorgrid/domain';

export function createTestWorldSpec(): WorldSpec {
  return {
    worldId: 'conformance-world',
    seed: 42n,
    services: [
      { id: 'gateway', name: 'Gateway', concurrencyLimit: 64, queueCapacity: 100, config: {} },
      { id: 'orders', name: 'Orders', concurrencyLimit: 32, queueCapacity: 50, config: {} },
      { id: 'payments', name: 'Payments', concurrencyLimit: 16, queueCapacity: 25, config: {} },
    ],
    dependencies: [
      {
        sourceId: 'gateway',
        targetId: 'orders',
        timeoutMs: 3000,
        retryPolicy: {
          type: 'EXPONENTIAL',
          maxAttempts: 3,
          baseDelayMs: 25,
          maxDelayMs: 500,
          jitterFactor: 0.1,
          budgetPercent: 10,
        },
        circuitBreakerPolicy: {
          enabled: true,
          threshold: 5,
          windowMs: 5000,
          cooldownMs: 5000,
          halfOpenProbes: 2,
        },
      },
      {
        sourceId: 'orders',
        targetId: 'payments',
        timeoutMs: 2000,
        retryPolicy: {
          type: 'EXPONENTIAL',
          maxAttempts: 3,
          baseDelayMs: 25,
          maxDelayMs: 500,
          jitterFactor: 0.1,
          budgetPercent: 10,
        },
        circuitBreakerPolicy: {
          enabled: true,
          threshold: 5,
          windowMs: 5000,
          cooldownMs: 5000,
          halfOpenProbes: 2,
        },
      },
    ],
  };
}

export async function runLifecycleSuite(adapter: RuntimeAdapter): Promise<void> {
  const spec = createTestWorldSpec();
  const handle = await adapter.provision(spec);
  assert(handle.id, 'Handle must be generated');

  await adapter.start(handle);

  const health = await adapter.health(handle);
  assert.strictEqual(health.length, 3, 'All 3 services must report health');

  for (const h of health) {
    assert.strictEqual(h.status, 'HEALTHY', `Service ${h.serviceId} must report HEALTHY`);
  }

  await adapter.teardown(handle);
}
