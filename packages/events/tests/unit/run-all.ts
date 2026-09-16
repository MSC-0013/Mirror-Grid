import { testTopicMatcher } from './topic-matcher.test.js';
import { testEnvelopeSchema } from './envelope.test.js';

async function runAll() {
  console.log('=== Running @mirrorgrid/events Unit Tests ===');
  await testTopicMatcher();
  await testEnvelopeSchema();
  console.log('=== All @mirrorgrid/events Unit Tests Passed ===');
}

runAll().catch((err) => {
  console.error('Unit tests failed:', err);
  process.exit(1);
});
