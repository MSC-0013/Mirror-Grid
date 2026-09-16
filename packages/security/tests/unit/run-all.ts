import { testArgon2 } from './argon2.test.js';
import { testHashChain } from './hash-chain.test.js';
import { testRateLimiter } from './token-bucket.test.js';
import { testAuthorizer } from './authorizer.test.js';

async function runAll() {
  console.log('=== Running @mirrorgrid/security Unit Tests ===');
  await testArgon2();
  await testHashChain();
  await testRateLimiter();
  await testAuthorizer();
  console.log('\n=== All @mirrorgrid/security Unit Tests PASSED! ===');
}

runAll().catch((err) => {
  console.error('Test failure:', err);
  process.exit(1);
});
