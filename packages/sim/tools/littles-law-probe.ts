import { SimEngine } from '../src/engine/sim-engine.js';
import { FastDriver } from '../src/clock/fast-driver.js';

const spec = {
  worldId: 'll',
  entryServiceId: 'svc',
  requestTimeoutMs: 60000,
  services: [{ id: 'svc', name: 'svc', concurrencyLimit: 64, queueCapacity: 4096 }],
  edges: [],
};
const engine = new SimEngine(spec as never);
const r = await engine.run({
  seed: 1234n,
  workload: { pattern: 'CONSTANT', baseRatePerSecond: 200, durationUs: 60_000_000n },
  driver: new FastDriver(),
});

const rows = r.metrics.filter((m) => m.serviceId === 'svc');
const warm = Math.floor(rows.length * 0.1);
const win = rows.slice(warm, rows.length - 1);

let lat = 0,
  n = 0,
  occ = 0;
for (const m of win) {
  for (const s of m.latencySamplesUs) {
    lat += s;
    n++;
  }
  occ += m.queueDepth + m.activeSlots;
}
const W = lat / n / 1e6;
const lambda = n / win.length;
const svc = r.services.find((s) => s.serviceId === 'svc')!;
const L_exact = Number(svc.occupancyIntegralUs) / Number(r.virtualDurationUs);
const L_measured = occ / win.length;
const L_expected = lambda * W;
console.log(`windows=${win.length} completions=${n}`);
console.log(`lambda = ${lambda.toFixed(3)} /s`);
console.log(`W      = ${(W * 1000).toFixed(3)} ms`);
console.log(`L meas = ${L_measured.toFixed(4)}`);
console.log(`L exp  = ${L_expected.toFixed(4)}  (lambda*W)`);
console.log(`L exact= ${L_exact.toFixed(4)}  (integral/duration)`);
const lamAll = r.totals.succeeded / (Number(r.virtualDurationUs) / 1e6);
let allLat = 0,
  allN = 0;
for (const m of rows) {
  for (const s of m.latencySamplesUs) {
    allLat += s;
    allN++;
  }
}
const Wall = allLat / allN / 1e6;
console.log(
  `sampled err = ${((Math.abs(L_measured - L_expected) / L_expected) * 100).toFixed(2)}%`,
);
console.log(
  `exact   err = ${((Math.abs(L_exact - lamAll * Wall) / (lamAll * Wall)) * 100).toFixed(2)}%  (vs lambda*W over full run)`,
);
