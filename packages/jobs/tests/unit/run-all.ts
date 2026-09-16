import { testLeaseManager } from './lease-manager.test.js';
import { testWorkerPool } from './worker-pool.test.js';

async function runAll() {
  console.log('=== Running @mirrorgrid/jobs Unit Tests ===');
  await testLeaseManager();
  await testWorkerPool();
  console.log('\n=== All @mirrorgrid/jobs Unit Tests PASSED! ===');
}

runAll().catch((err) => {
  console.error('Test failure:', err);
  process.exit(1);
});
