import assert from 'node:assert';
import { hashPassword, verifyPassword } from '../../src/auth/argon2.js';

export async function testArgon2() {
  console.log('Testing Argon2id password hashing...');
  const password = 'SuperSecretSecurePassword123!';
  const hash = await hashPassword(password);

  assert(
    typeof hash === 'string' && hash.startsWith('$argon2id$'),
    'Must be an Argon2id hash string',
  );
  assert(
    await verifyPassword(hash, password),
    'Password verification must succeed for valid password',
  );
  assert(
    !(await verifyPassword(hash, 'WrongPassword456!')),
    'Password verification must fail for invalid password',
  );
  console.log('✓ Argon2id hashing & verification verified.');
}
