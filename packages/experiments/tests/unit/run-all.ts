import { spawnSync } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const tests = ['freeze.test.ts', 'detector-engine.test.ts', 'orchestrator.test.ts', 'campaign.test.ts'];

console.log('====================================================');
console.log('Running @mirrorgrid/experiments unit tests...');
console.log('====================================================');

for (const test of tests) {
  const filePath = path.join(__dirname, test);
  const res = spawnSync('node', ['--import', 'tsx', filePath], {
    stdio: 'inherit',
    env: process.env,
  });

  if (res.status !== 0) {
    console.error(`FAILED: ${test}`);
    process.exit(1);
  }
}

console.log('\nAll @mirrorgrid/experiments unit tests passed cleanly!\n');
