import assert from 'node:assert';
import { NamespaceManager, HaValidator } from '../../src/index.js';

console.log('--- Testing High Availability Validator & Namespace Manager ---');

const manager = new NamespaceManager();
const ns = 'test-ha-ns';

// 1. Lifecycle test
manager.createNamespace(ns);
const initialPods = manager.provisionPods(ns, 'order-service', 3);
assert.strictEqual(initialPods.length, 3);
assert.strictEqual(manager.getPods(ns).length, 3);
console.log('? Namespace and 3 pods provisioned successfully');

// 2. Pod termination HA test (preStop hook + endpoints drain)
const termResult = await HaValidator.validatePodTermination({
  manager,
  namespace: ns,
  serviceName: 'order-service',
  trafficRps: 250,
  testDurationSeconds: 2,
});

assert.strictEqual(termResult.testType, 'POD_KILL');
assert.strictEqual(termResult.failedRequests, 0, 'Zero requests must fail during graceful pod termination');
assert.strictEqual(termResult.availabilityPercentage, 100, '100% availability must be achieved');
assert.strictEqual(termResult.zeroDowntimeAchieved, true);
console.log(`? Graceful Pod Kill under load: ${termResult.successfulRequests}/${termResult.totalRequests} succeeded (100% HA)`);

// 3. Rolling deploy HA test (maxSurge: 1, maxUnavailable: 0)
const rollResult = await HaValidator.validateRollingDeploy({
  manager,
  namespace: ns,
  serviceName: 'order-service',
  newImageTag: 'mirrorgrid/order-service:v2',
  trafficRps: 300,
});

assert.strictEqual(rollResult.testType, 'ROLLING_UPDATE');
assert.strictEqual(rollResult.failedRequests, 0, 'Zero requests must fail during rolling deploy');
assert.strictEqual(rollResult.availabilityPercentage, 100);
assert.strictEqual(rollResult.zeroDowntimeAchieved, true);
console.log(`? Rolling Deploy under load: ${rollResult.successfulRequests}/${rollResult.totalRequests} succeeded (100% HA)`);

// 4. Cascade namespace deletion
const deleteRes = manager.deleteNamespace(ns);
assert.strictEqual(deleteRes.deleted, true);
assert.ok(deleteRes.purgedPodCount > 0);
assert.strictEqual(manager.isNamespaceCleanlyDeleted(ns), true);
console.log(`? Ephemeral namespace cascade teardown cleanly purged ${deleteRes.purgedPodCount} pods`);

console.log('All HA Validator Unit Tests Passed!\n');
