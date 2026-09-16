import { SimEngine } from '../src/engine/sim-engine.js';
import { FastDriver } from '../src/clock/fast-driver.js';

const spec = {
  worldId: 'metro-01',
  entryServiceId: 'gateway',
  requestTimeoutMs: 3000,
  services: [
    { id: 'gateway', name: 'Gateway', concurrencyLimit: 128, queueCapacity: 512 },
    { id: 'orders', name: 'Orders', concurrencyLimit: 64, queueCapacity: 256 },
    { id: 'payments', name: 'Payments', concurrencyLimit: 32, queueCapacity: 256 },
  ],
  edges: [
    { sourceId: 'gateway', targetId: 'orders', timeoutMs: 3000 },
    { sourceId: 'orders', targetId: 'payments', timeoutMs: 1000 },
  ],
} as const;

async function run(seed: bigint) {
  const engine = new SimEngine(spec as never);
  return engine.run({
    seed,
    workload: { pattern: 'CONSTANT', baseRatePerSecond: 500, durationUs: 5_000_000n },
    driver: new FastDriver(),
  });
}

const a = await run(42n);
const b = await run(42n);
const c = await run(43n);

console.log('seed 42 run A :', a.stateHash.root.slice(0, 32));
console.log('seed 42 run B :', b.stateHash.root.slice(0, 32));
console.log('seed 43 run C :', c.stateHash.root.slice(0, 32));
console.log('A === B (determinism):', a.stateHash.root === b.stateHash.root);
console.log('A !== C (seed sensitivity):', a.stateHash.root !== c.stateHash.root);
console.log('totals A:', JSON.stringify(a.totals));
console.log('virtual duration A:', Number(a.virtualDurationUs) / 1e6, 's');
console.log('metric rows A:', a.metrics.length);
const gw = a.metrics.filter((m) => m.serviceId === 'gateway').slice(0, 3);
for (const m of gw) {
  console.log(`  gateway t=${Number(m.virtualTimeUs)/1e6}s reqs=${m.requestsTotal} failed=${m.requestsFailed} p95=${m.quantiles.p95}us (${m.quantiles.quality}) q=${m.queueDepth}`);
}
