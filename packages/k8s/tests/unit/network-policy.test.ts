import assert from 'node:assert';
import { ManifestGenerator, buildNetworkPolicySpec } from '../../src/index.js';

console.log('--- Testing Kubernetes Network Policy Compiler ---');

const netpolOrders = buildNetworkPolicySpec({
  targetService: 'orders',
  namespace: 'mg-world-demo',
  worldId: 'demo-wld',
  allowedSourceServices: ['gateway'],
  port: 8081,
});

assert.strictEqual(netpolOrders.apiVersion, 'networking.k8s.io/v1');
assert.strictEqual(netpolOrders.kind, 'NetworkPolicy');

const valRes = ManifestGenerator.validateSchema(netpolOrders);
assert.strictEqual(valRes.valid, true);

const spec = netpolOrders.spec as Record<string, unknown>;
const podSel = spec.podSelector as Record<string, unknown>;
const matchLabels = podSel.matchLabels as Record<string, string>;
assert.strictEqual(matchLabels.app, 'orders');

const ingress = spec.ingress as Array<Record<string, unknown>>;
assert.strictEqual(ingress.length, 1);
const rule = ingress[0]!;
const from = rule.from as Array<Record<string, unknown>>;
assert.strictEqual(from.length, 1);
const fromPodSel = from[0]!.podSelector as Record<string, unknown>;
const fromLabels = fromPodSel.matchLabels as Record<string, string>;
assert.strictEqual(fromLabels.app, 'gateway');

console.log('? NetworkPolicy correctly isolates ingress to declared dependency edge (gateway -> orders)');

// Test isolated service with zero callers
const netpolGateway = buildNetworkPolicySpec({
  targetService: 'gateway',
  namespace: 'mg-world-demo',
  worldId: 'demo-wld',
  allowedSourceServices: [],
});
const gwSpec = netpolGateway.spec as Record<string, unknown>;
const gwIngress = gwSpec.ingress as Array<unknown>;
assert.strictEqual(gwIngress.length, 0, 'Service with no callers has 0 ingress rules');
console.log('? Uncallable internal service has zero ingress rules');

console.log('All Network Policy Unit Tests Passed!\n');
