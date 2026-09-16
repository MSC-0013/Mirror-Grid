import assert from 'node:assert';
import { DependencyGraph } from './graph.js';
import {
  detectCycles,
  topologicalOrder,
  reachableFrom,
  criticalPath,
  dependentsOf,
} from './algorithms.js';
import { isValidWorldTransition, assertValidWorldTransition } from '../world/world-status.js';
import {
  isValidServiceTransition,
  assertValidServiceTransition,
} from '../service/service-status.js';

console.log('Testing Graph Algorithms & State Machine Transitions...\n');

// 1. Cycle Detection (DAG)
const dag = new DependencyGraph(['A', 'B', 'C', 'D']);
dag.addEdge('A', 'B');
dag.addEdge('B', 'C');
dag.addEdge('A', 'C');
dag.addEdge('C', 'D');

const dagCycle = detectCycles(dag);
assert.strictEqual(dagCycle, null, 'DAG should have no cycles');
console.log('✓ detectCycles returns null for DAG');

// 2. Cycle Detection (Cyclic)
const cyclic = new DependencyGraph(['A', 'B', 'C']);
cyclic.addEdge('A', 'B');
cyclic.addEdge('B', 'C');
cyclic.addEdge('C', 'A');

const cycleResult = detectCycles(cyclic);
assert(cycleResult !== null, 'Cycle must be detected');
assert(cycleResult.services.length >= 3, 'Cycle path must contain nodes');
assert.strictEqual(
  cycleResult.services[0],
  cycleResult.services[cycleResult.services.length - 1],
  'Cycle path start and end must match',
);
console.log('✓ detectCycles detects cycle:', cycleResult.services.join(' -> '));

// 3. Topological Order
const topoOrder = topologicalOrder(dag);
assert.strictEqual(topoOrder[0], 'A', 'Source node must come first');
assert.strictEqual(topoOrder[topoOrder.length - 1], 'D', 'Sink node must come last');
console.log('✓ topologicalOrder returns correct order:', topoOrder.join(', '));

assert.throws(
  () => topologicalOrder(cyclic),
  /contains a cycle/,
  'topologicalOrder throws on cyclic graph',
);
console.log('✓ topologicalOrder throws error on cyclic graph');

// 4. Reference Topology (§10)
// Gateway -> Orders, Users
// Orders -> Inventory, Payments
// Payments -> Postgres
// Users -> Postgres
const refGraph = new DependencyGraph([
  'gateway',
  'orders',
  'users',
  'inventory',
  'payments',
  'postgres',
]);
refGraph.addEdge('gateway', 'orders');
refGraph.addEdge('gateway', 'users');
refGraph.addEdge('orders', 'inventory');
refGraph.addEdge('orders', 'payments');
refGraph.addEdge('payments', 'postgres');
refGraph.addEdge('users', 'postgres');

// 5. reachableFrom('payments') -> { orders, gateway }
const callersOfPayments = reachableFrom(refGraph, 'payments');
assert.strictEqual(
  callersOfPayments.size,
  2,
  'Payments reachable from exactly 2 upstream services',
);
assert(callersOfPayments.has('orders'), 'Orders can reach Payments');
assert(callersOfPayments.has('gateway'), 'Gateway can reach Payments');
assert(!callersOfPayments.has('users'), 'Users cannot reach Payments');
assert(!callersOfPayments.has('postgres'), 'Postgres cannot reach Payments');
console.log('✓ reachableFrom("payments") returns exact set: { orders, gateway }');

// 6. dependentsOf('orders') -> { inventory, payments, postgres }
const dependentsOfOrders = dependentsOf(refGraph, 'orders');
assert.strictEqual(dependentsOfOrders.size, 3);
assert(dependentsOfOrders.has('inventory'));
assert(dependentsOfOrders.has('payments'));
assert(dependentsOfOrders.has('postgres'));
console.log('✓ dependentsOf("orders") returns { inventory, payments, postgres }');

// 7. criticalPath('gateway', 'postgres') -> gateway -> orders -> payments -> postgres (length 4)
const critPath = criticalPath(refGraph, 'gateway', 'postgres');
assert.strictEqual(critPath.length, 4, 'Critical path length must be 4');
assert.deepStrictEqual(critPath, ['gateway', 'orders', 'payments', 'postgres']);
console.log('✓ criticalPath("gateway", "postgres") found longest path:', critPath.join(' -> '));

// 8. World State Machine Transitions
assert(isValidWorldTransition('IDLE', 'RUNNING'));
assert(isValidWorldTransition('RUNNING', 'PAUSED'));
assert(isValidWorldTransition('PAUSED', 'RUNNING'));
assert(isValidWorldTransition('RUNNING', 'COMPLETED'));
assert(!isValidWorldTransition('COMPLETED', 'RUNNING'), 'COMPLETED -> RUNNING must be illegal');
assert.throws(
  () => assertValidWorldTransition('COMPLETED', 'RUNNING'),
  /Illegal world status transition/,
);
console.log('✓ WorldStatus state machine enforced');

// 9. Service State Machine Transitions
assert(isValidServiceTransition('STOPPED', 'STARTING'));
assert(isValidServiceTransition('STARTING', 'HEALTHY'));
assert(isValidServiceTransition('HEALTHY', 'DEGRADED'));
assert(isValidServiceTransition('DEGRADED', 'PARTIALLY_AVAILABLE'));
assert(isValidServiceTransition('PARTIALLY_AVAILABLE', 'UNHEALTHY'));
assert(isValidServiceTransition('UNHEALTHY', 'FAILED'));
assert(isValidServiceTransition('FAILED', 'STARTING'));
assert(
  !isValidServiceTransition('STOPPED', 'HEALTHY'),
  'STOPPED -> HEALTHY directly must be illegal',
);
assert.throws(
  () => assertValidServiceTransition('STOPPED', 'HEALTHY'),
  /Illegal service status transition/,
);
console.log('✓ ServiceStatus state machine enforced (8 states)');

console.log('\nAll packages/domain unit tests passed successfully!\n');
