import assert from 'node:assert';
import {
  MerkleSnapshotService,
  DeduplicatedStorage,
  type ComponentSnapshot,
} from '../../src/index.js';

console.log('--- Testing Incremental Checkpoint Deduplication ---');

// Create 20 components
function generateComponents(tick: number, changeOnlyOrders: boolean): ComponentSnapshot[] {
  const components: ComponentSnapshot[] = [];
  for (let i = 1; i <= 20; i++) {
    const serviceName = `service-${i}`;
    // Only service-1 changes with tick; services 2-20 remain identical
    const queueVal = i === 1 && changeOnlyOrders ? tick * 5 : 42;
    components.push(
      MerkleSnapshotService.createComponent('SERVICE_STATE', serviceName, {
        queueDepth: queueVal,
        capacity: 1000,
        status: 'HEALTHY',
      }),
    );
  }
  return components;
}

const storage = new DeduplicatedStorage();

// Snapshot 1 (Tick 1)
const snap1Components = generateComponents(1, false);
const snap1 = MerkleSnapshotService.createSnapshot({
  worldId: 'world-dedup-01',
  simTimeMicros: 1000,
  sequenceNum: 1,
  components: snap1Components,
});
storage.storeSnapshot(snap1);

// Snapshot 2 (Tick 2: only service-1 changes)
const snap2Components = generateComponents(2, true);
const snap2 = MerkleSnapshotService.createSnapshot({
  worldId: 'world-dedup-01',
  simTimeMicros: 2000,
  sequenceNum: 2,
  components: snap2Components,
  previousSnapshot: snap1,
});
storage.storeSnapshot(snap2);

// Snapshot 3 (Tick 3: only service-1 changes)
const snap3Components = generateComponents(3, true);
const snap3 = MerkleSnapshotService.createSnapshot({
  worldId: 'world-dedup-01',
  simTimeMicros: 3000,
  sequenceNum: 3,
  components: snap3Components,
  previousSnapshot: snap2,
});
storage.storeSnapshot(snap3);

const metrics = storage.getMetrics();
console.log('Storage Deduplication Metrics:', {
  totalComponents: metrics.totalComponentsObserved,
  deduplicatedCount: metrics.deduplicatedCount,
  ratio: `${(metrics.deduplicationRatio * 100).toFixed(1)}%`,
  rawBytes: metrics.rawBytes,
  storedBytes: metrics.storedBytes,
});

// Assertions
// 1. In snapshots 2 and 3, 19 of 20 components are identical:
assert.ok(
  metrics.deduplicationRatio >= 0.8,
  `Deduplication ratio must be >= 80% (got ${(metrics.deduplicationRatio * 100).toFixed(1)}%)`,
);

// 2. Hydration verification
const hydrated = storage.hydrateSnapshot(snap2);
const s2Comp1 = hydrated.components.find((c) => c.componentId === 'service-1')!;
const s2Comp2 = hydrated.components.find((c) => c.componentId === 'service-2')!;

assert.strictEqual(s2Comp1.payload['queueDepth'], 10);
assert.strictEqual(s2Comp2.payload['queueDepth'], 42);
console.log('✓ Hydration correctly reconstituted deduplicated payloads');

console.log('All Deduplication Unit Tests Passed!\n');
