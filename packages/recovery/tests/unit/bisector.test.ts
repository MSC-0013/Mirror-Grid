import assert from 'node:assert';
import {
  MerkleSnapshotService,
  CheckpointBisector,
  type MerkleSnapshot,
} from '../../src/index.js';

console.log('--- Testing Checkpoint Bisection Tool ---');

const TOTAL_CHECKPOINTS = 100;
const DRIFT_INDEX = 63; // 64th checkpoint (0-indexed 63)
const DRIFT_TIME = 64_000;

const run1Snapshots: MerkleSnapshot[] = [];
const run2Snapshots: MerkleSnapshot[] = [];

for (let i = 0; i < TOTAL_CHECKPOINTS; i++) {
  const simTime = (i + 1) * 1000;

  // Normal run 1
  const c1 = MerkleSnapshotService.createComponent('SERVICE_STATE', 'gateway', { q: i });
  const c2 = MerkleSnapshotService.createComponent('SERVICE_STATE', 'orders', { q: i * 2 });
  const c3 = MerkleSnapshotService.createComponent('SERVICE_STATE', 'payments', { q: 10 });

  const s1 = MerkleSnapshotService.createSnapshot({
    worldId: 'world-bisect',
    simTimeMicros: simTime,
    sequenceNum: i + 1,
    components: [c1, c2, c3],
  });
  run1Snapshots.push(s1);

  // Run 2: identical until DRIFT_INDEX where orders introduces 1-byte drift
  const r2OrdersQ = i >= DRIFT_INDEX ? i * 2 + 1 : i * 2;
  const r2c1 = MerkleSnapshotService.createComponent('SERVICE_STATE', 'gateway', { q: i });
  const r2c2 = MerkleSnapshotService.createComponent('SERVICE_STATE', 'orders', { q: r2OrdersQ });
  const r2c3 = MerkleSnapshotService.createComponent('SERVICE_STATE', 'payments', { q: 10 });

  const s2 = MerkleSnapshotService.createSnapshot({
    worldId: 'world-bisect',
    simTimeMicros: simTime,
    sequenceNum: i + 1,
    components: [r2c1, r2c2, r2c3],
  });
  run2Snapshots.push(s2);
}

// Bisect
const diff = CheckpointBisector.findDivergence(run1Snapshots, run2Snapshots);

assert.ok(diff, 'Bisector must find divergence');
console.log('Bisection Result:', {
  simTimeMicros: diff.simTimeMicros,
  component: `${diff.componentType}:${diff.componentId}`,
  iterations: diff.iterationCount,
  run1Hash: diff.run1Hash.slice(0, 10),
  run2Hash: diff.run2Hash.slice(0, 10),
});

// Assertions
assert.strictEqual(diff.simTimeMicros, DRIFT_TIME, `Divergence time must be ${DRIFT_TIME}`);
assert.strictEqual(diff.componentId, 'orders', `Divergent component must be orders`);
assert.strictEqual(diff.componentType, 'SERVICE_STATE');
assert.notStrictEqual(diff.run1Hash, diff.run2Hash);

// Mathematical iteration bound: ceil(log2(100)) = 7
assert.ok(
  diff.iterationCount <= 7,
  `Binary search bisection must complete in <= 7 iterations for 100 checkpoints (took ${diff.iterationCount})`,
);

console.log('✓ Assertion passed: Bisection located divergence at #64 in <= 7 binary steps!');
console.log('All Bisector Unit Tests Passed!\n');
