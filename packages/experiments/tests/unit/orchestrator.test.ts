import assert from 'node:assert';
import { createFlagshipScenario } from '../../src/scenarios/flagship.js';
import { ExperimentOrchestrator } from '../../src/engine/orchestrator.js';

async function testOrchestrator() {
  console.log('Testing ExperimentOrchestrator...');

  const config = createFlagshipScenario({
    isProtected: true,
    baselineDurationMicros: 5_000_000n, // 5s fast test
    faultDurationMicros: 5_000_000n, // 5s fast test
    cooldownDurationMicros: 5_000_000n, // 5s fast test
    seed: '42',
  });

  const orchestrator = new ExperimentOrchestrator({ config });
  const summary = await orchestrator.execute('FAST');

  assert.strictEqual(summary.status, 'COMPLETED', 'Experiment should complete successfully');
  assert(
    summary.stateHash && summary.stateHash.length === 64,
    'State hash should be valid 64-char hex',
  );
  assert(summary.timeline.length > 0, 'Timeline events should be recorded');
  assert(summary.metrics.length > 0, 'Metrics should be collected');

  console.log(`✓ Orchestrator run completed with state hash: ${summary.stateHash.slice(0, 16)}...`);
  console.log('✓ ExperimentOrchestrator tests passed cleanly');
}

testOrchestrator().catch((err) => {
  console.error(err);
  process.exit(1);
});
