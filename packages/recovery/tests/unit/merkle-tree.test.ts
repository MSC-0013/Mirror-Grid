import assert from 'node:assert';
import {
  MerkleSnapshotService,
  canonicalStringify,
} from '../../src/index.js';

console.log('--- Testing Merkle Tree & Deterministic Hashing ---');

// 1. Key order invariance
const objA = { z: 1, a: 2, m: { nestedB: true, nestedA: 'hello' } };
const objB = { a: 2, m: { nestedA: 'hello', nestedB: true }, z: 1 };

const strA = canonicalStringify(objA);
const strB = canonicalStringify(objB);

assert.strictEqual(strA, strB, 'Canonical serialization must sort all keys recursively');
console.log('✓ Canonical serialization is strictly key-order invariant');

// 2. Merkle Root Hash reproducibility
const comp1 = MerkleSnapshotService.createComponent('SERVICE_STATE', 'orders', {
  queueDepth: 5,
  inFlight: 2,
});
const comp2 = MerkleSnapshotService.createComponent('CIRCUIT_BREAKER', 'orders-to-pay', {
  state: 'CLOSED',
  failureCount: 0,
});
const comp3 = MerkleSnapshotService.createComponent('SERVICE_STATE', 'gateway', {
  status: 'HEALTHY',
  rateLimit: 100,
});

// Pass in different order
const list1 = [comp1, comp2, comp3];
const list2 = [comp3, comp1, comp2];

const root1 = MerkleSnapshotService.computeMerkleRoot(list1);
const root2 = MerkleSnapshotService.computeMerkleRoot(list2);

assert.strictEqual(root1, root2, 'Merkle root hash must be order-independent and deterministic');
assert.strictEqual(root1.length, 64, 'Merkle root must be a 64-character SHA-256 hex string');
console.log(`✓ Merkle root hash is strictly deterministic: 0x${root1.slice(0, 12)}...`);

console.log('All Merkle Tree Unit Tests Passed!\n');
