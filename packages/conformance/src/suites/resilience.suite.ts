import assert from 'node:assert';
import type { RuntimeAdapter } from '@mirrorgrid/domain';
import { createTestWorldSpec } from './lifecycle.suite.js';

export async function runResilienceSuite(adapter: RuntimeAdapter): Promise<void> {
  const spec = createTestWorldSpec();
  const handle = await adapter.provision(spec);
  await adapter.start(handle);

  const fault = await adapter.applyFault(handle, {
    faultId: 'fault-lat-1',
    type: 'LATENCY',
    targetServiceId: 'payments',
    parameters: { latencyMs: 100 },
    ttlMs: 5000,
  });
  assert(fault.id, 'Fault must be applied and return an ID');

  await adapter.removeFault(handle, fault);
  await adapter.teardown(handle);
}
