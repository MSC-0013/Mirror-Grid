import assert from 'node:assert';
import { createFlagshipScenario } from '../../src/scenarios/flagship.js';
import { ExperimentFreezer } from '../../src/engine/freeze.js';

async function testFreeze() {
  console.log('Testing ExperimentFreezer...');

  const configA = createFlagshipScenario({ isProtected: true, seed: '42' });
  const frozenA = ExperimentFreezer.freeze(configA);
  const hashA1 = ExperimentFreezer.computeHash(frozenA);
  const hashA2 = ExperimentFreezer.computeHash(frozenA);

  assert.strictEqual(hashA1, hashA2, 'Hash should be deterministic for identical config');

  const configB = createFlagshipScenario({ isProtected: false, seed: '42' });
  const frozenB = ExperimentFreezer.freeze(configB);
  const hashB = ExperimentFreezer.computeHash(frozenB);

  assert.notStrictEqual(
    hashA1,
    hashB,
    'Protected vs Unprotected config should produce different hashes',
  );

  console.log('✓ ExperimentFreezer tests passed cleanly');
}

testFreeze().catch((err) => {
  console.error(err);
  process.exit(1);
});
