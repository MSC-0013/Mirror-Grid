import type { RuntimeAdapter } from '@mirrorgrid/domain';
import { runLifecycleSuite } from './suites/lifecycle.suite.js';
import { runTrafficSuite } from './suites/traffic.suite.js';
import { runResilienceSuite } from './suites/resilience.suite.js';

export * from './suites/lifecycle.suite.js';
export * from './suites/traffic.suite.js';
export * from './suites/resilience.suite.js';

export async function runConformanceSuite(
  adapter: RuntimeAdapter,
): Promise<{ passed: boolean; suitesPassed: number }> {
  console.log(`    --> Running Conformance Suite on [${adapter.mode}] runtime adapter...`);

  await runLifecycleSuite(adapter);
  console.log(`      ✓ Lifecycle suite passed`);

  await runTrafficSuite(adapter);
  console.log(`      ✓ Traffic & observation suite passed`);

  await runResilienceSuite(adapter);
  console.log(`      ✓ Resilience fault suite passed`);

  return { passed: true, suitesPassed: 3 };
}
