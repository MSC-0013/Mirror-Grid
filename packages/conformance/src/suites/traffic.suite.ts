import assert from 'node:assert';
import type { RuntimeAdapter } from '@mirrorgrid/domain';
import { createTestWorldSpec } from './lifecycle.suite.js';

export async function runTrafficSuite(adapter: RuntimeAdapter): Promise<void> {
  const spec = createTestWorldSpec();
  const handle = await adapter.provision(spec);
  await adapter.start(handle);

  const workload = await adapter.applyWorkload(handle, {
    pattern: 'CONSTANT',
    targetServiceId: 'gateway',
    baseRate: 20,
    durationMs: 500,
  });
  assert(workload.id, 'Workload must be accepted and return an ID');

  let sampleObserved = false;
  for await (const sample of adapter.observe(handle)) {
    if (sample) {
      sampleObserved = true;
      assert(sample.serviceId, 'Sample must contain serviceId');
      break;
    }
  }

  assert.strictEqual(sampleObserved, true, 'At least one telemetry sample must be observed');
  await adapter.teardown(handle);
}
