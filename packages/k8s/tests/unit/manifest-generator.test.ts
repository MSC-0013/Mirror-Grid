import assert from 'node:assert';
import { ManifestGenerator } from '../../src/index.js';

console.log('--- Testing Manifest Generator & OpenAPI Validation ---');

const worldId = 'wld-test-01';
const services = [
  { id: 's1', name: 'gateway', replicas: 2, port: 8080 },
  { id: 's2', name: 'orders', replicas: 3, port: 8081 },
  { id: 's3', name: 'payments', replicas: 2, port: 8082 },
];
const dependencies = [
  { sourceServiceName: 'gateway', targetServiceName: 'orders' },
  { sourceServiceName: 'orders', targetServiceName: 'payments' },
];

const bundle = ManifestGenerator.compileWorld({
  worldId,
  services,
  dependencies,
});

// 1. Namespace verification
assert.strictEqual(bundle.namespace, 'mg-world-wld-test-01');
assert.strictEqual(bundle.namespaceSpec.apiVersion, 'v1');
assert.strictEqual(bundle.namespaceSpec.kind, 'Namespace');
const nsMeta = bundle.namespaceSpec.metadata as Record<string, unknown>;
assert.strictEqual(nsMeta.name, 'mg-world-wld-test-01');
console.log('? Namespace spec generated correctly');

// 2. Deployments verification
assert.strictEqual(bundle.deployments.length, 3);
for (const dep of bundle.deployments) {
  const validation = ManifestGenerator.validateSchema(dep);
  assert.strictEqual(validation.valid, true, `Deployment failed validation: ${validation.errors.join(', ')}`);
  
  const spec = dep.spec as Record<string, unknown>;
  const strategy = spec.strategy as Record<string, unknown>;
  const rolling = strategy.rollingUpdate as Record<string, unknown>;
  assert.strictEqual(rolling.maxUnavailable, 0, 'Zero-downtime rolling update requires maxUnavailable: 0');
  assert.strictEqual(rolling.maxSurge, 1, 'maxSurge must be 1');

  // Verify preStop hook and readiness probe
  const template = spec.template as Record<string, unknown>;
  const templateSpec = template.spec as Record<string, unknown>;
  const containers = templateSpec.containers as Array<Record<string, unknown>>;
  assert.ok(containers.length > 0);
  const c0 = containers[0]!;
  assert.ok(c0.readinessProbe, 'Readiness probe must be defined');
  assert.ok(c0.livenessProbe, 'Liveness probe must be defined');
  const lifecycle = c0.lifecycle as Record<string, unknown>;
  assert.ok(lifecycle.preStop, 'preStop hook must be configured');
}
console.log('? All 3 Deployment specs generated with zero-downtime rolling update & preStop hooks');

// 3. Services verification
assert.strictEqual(bundle.services.length, 3);
for (const svc of bundle.services) {
  const validation = ManifestGenerator.validateSchema(svc);
  assert.strictEqual(validation.valid, true, `Service failed validation: ${validation.errors.join(', ')}`);
  const spec = svc.spec as Record<string, unknown>;
  assert.strictEqual(spec.type, 'ClusterIP');
}
console.log('? All 3 Service specs generated with ClusterIP');

// 4. Schema validation failure cases
const invalidDep = {
  apiVersion: 'apps/v1',
  kind: 'Deployment',
  metadata: { name: 'bad-dep' },
  spec: { replicas: -1 },
};
const invRes = ManifestGenerator.validateSchema(invalidDep);
assert.strictEqual(invRes.valid, false);
assert.ok(invRes.errors.length >= 2, 'Invalid deployment must report errors');
console.log('? OpenAPI validation catches schema violations');

console.log('All Manifest Generator Unit Tests Passed!\n');
