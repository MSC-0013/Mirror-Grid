import { testW3CTraceContext } from './w3c.test.js';
import { testHistogram } from './histogram.test.js';
import { testWaterfallBuilder } from './waterfall-builder.test.js';

async function runAll() {
  console.log('=== Running @mirrorgrid/observability Unit Tests ===');
  await testW3CTraceContext();
  await testHistogram();
  await testWaterfallBuilder();
  console.log('=== All @mirrorgrid/observability Unit Tests Passed ===');
}

runAll().catch((err) => {
  console.error('Unit tests failed:', err);
  process.exit(1);
});
