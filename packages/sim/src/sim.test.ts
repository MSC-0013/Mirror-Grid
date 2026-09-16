import {
  describe,
  it,
  assert,
  assertEqual,
  assertClose,
  assertThrows,
  runAll,
} from './test-harness.js';

import { VirtualClock } from './clock/virtual-clock.js';
import { EventPriority } from './clock/types.js';
import { SeedableRng } from './rng/rng.js';
import { BoundedQueue } from './queueing/queue.js';
import { BoundedConcurrencyService, type SimRequest } from './queueing/service-model.js';
import { LogLinearHistogram } from './metrics/histogram.js';
import { SecondBucket, exactQuantile } from './metrics/bucket.js';
import { CanonicalSerializer } from './hash/canonical.js';
import { MerkleHash } from './hash/merkle.js';
import { ComponentHasher } from './hash/hasher.js';
import { WorkloadGenerator } from './workload/generator.js';
import { ICDFRegistry } from './icdf/registry.js';
import { ICDF_MANIFEST } from './icdf/manifest.js';
import { computeStateHash, compareStateHashes } from './engine/state-hash.js';
import { HASH_SCHEMA_VERSION } from './engine/world-state.js';

const req = (id: string, deadlineUs: bigint, enqueuedAtUs = 0n): SimRequest => ({
  id,
  deadlineUs,
  enqueuedAtUs,
  depth: 0,
});

// ---------------------------------------------------------------------------

describe('VirtualClock', () => {
  it('drains events in time order regardless of insertion order', () => {
    const clock = new VirtualClock();
    const order: number[] = [];
    for (const t of [500n, 100n, 300n, 200n]) {
      clock.schedule({
        timeUs: t,
        priority: EventPriority.NORMAL,
        type: 'T',
        execute: () => {
          order.push(Number(t));
        },
      });
    }
    clock.drain();
    assertEqual(order.join(','), '100,200,300,500', 'events must drain in time order');
  });

  it('orders simultaneous events by priority, then by insertion sequence', () => {
    const clock = new VirtualClock();
    const order: string[] = [];
    clock.schedule({
      timeUs: 100n,
      priority: EventPriority.LOW,
      type: 'T',
      execute: () => {
        order.push('low');
      },
    });
    clock.schedule({
      timeUs: 100n,
      priority: EventPriority.HIGH,
      type: 'T',
      execute: () => {
        order.push('high-first');
      },
    });
    clock.schedule({
      timeUs: 100n,
      priority: EventPriority.HIGH,
      type: 'T',
      execute: () => {
        order.push('high-second');
      },
    });
    clock.drain();
    assertEqual(
      order.join(','),
      'high-first,high-second,low',
      'priority must beat insertion order; equal priority must keep insertion order',
    );
  });

  it('refuses to schedule into the past', () => {
    const clock = new VirtualClock();
    clock.schedule({ timeUs: 100n, priority: 0, type: 'T', execute: () => {} });
    clock.drain();
    assertThrows(
      () => clock.schedule({ timeUs: 50n, priority: 0, type: 'T', execute: () => {} }),
      'scheduling before now must throw',
    );
  });
});

// ---------------------------------------------------------------------------

describe('SeedableRng', () => {
  it('produces an identical sequence for the same seed', () => {
    const a = new SeedableRng(42n).stream('s');
    const b = new SeedableRng(42n).stream('s');
    for (let i = 0; i < 1000; i++) {
      assertEqual(a.nextUint32(), b.nextUint32(), `draw ${i} must match`);
    }
  });

  it('produces a different sequence for a different seed', () => {
    const a = new SeedableRng(42n).stream('s');
    const b = new SeedableRng(43n).stream('s');
    let differences = 0;
    for (let i = 0; i < 100; i++) {
      if (a.nextUint32() !== b.nextUint32()) differences++;
    }
    assert(differences > 90, `expected mostly different draws, got ${differences}/100`);
  });

  it('isolates substreams: adding a new stream does not perturb existing ones', () => {
    // Baseline: two streams, no third.
    const baseline = new SeedableRng(42n);
    const baseA: number[] = [];
    const baseB: number[] = [];
    for (let i = 0; i < 500; i++) baseA.push(baseline.stream('A').nextUint32());
    for (let i = 0; i < 500; i++) baseB.push(baseline.stream('B').nextUint32());

    // Same seed, but stream C is created first and drawn from heavily.
    const withC = new SeedableRng(42n);
    const c = withC.stream('C');
    for (let i = 0; i < 10_000; i++) c.nextUint32();

    for (let i = 0; i < 500; i++) {
      assertEqual(withC.stream('A').nextUint32(), baseA[i], `stream A draw ${i} must be unchanged`);
    }
    for (let i = 0; i < 500; i++) {
      assertEqual(withC.stream('B').nextUint32(), baseB[i], `stream B draw ${i} must be unchanged`);
    }
  });

  it('bernoulliTrial respects its parts-per-billion threshold', () => {
    const stream = new SeedableRng(7n).stream('bern');
    let hits = 0;
    const trials = 100_000;
    for (let i = 0; i < trials; i++) {
      if (stream.bernoulliTrial(250_000_000)) hits++; // 25%
    }
    assertClose(hits / trials, 0.25, 5, 'bernoulli rate should approach 25%');
  });
});

// ---------------------------------------------------------------------------

describe('BoundedQueue', () => {
  it('is FIFO and refuses to exceed capacity', () => {
    const q = new BoundedQueue<number>(3);
    assert(q.enqueue(1) && q.enqueue(2) && q.enqueue(3), 'first three must be accepted');
    assert(!q.enqueue(4), 'fourth must be rejected when full');
    assertEqual(q.depth, 3, 'depth');
    assertEqual(q.dequeue(), 1, 'FIFO order');
    assertEqual(q.dequeue(), 2, 'FIFO order');
    assert(q.enqueue(4), 'space freed by dequeue must be reusable');
    assertEqual(q.toArray().join(','), '3,4', 'ring buffer must wrap correctly');
  });

  it('removeWhere preserves the order of retained items', () => {
    const q = new BoundedQueue<number>(6);
    for (const n of [1, 2, 3, 4, 5, 6]) q.enqueue(n);
    const removed = q.removeWhere((n) => n % 2 === 0);
    assertEqual(removed.join(','), '2,4,6', 'removed items');
    assertEqual(q.toArray().join(','), '1,3,5', 'retained items keep FIFO order');
  });
});

// ---------------------------------------------------------------------------

describe('BoundedConcurrencyService', () => {
  it('admits up to the concurrency limit, then queues, then rejects', () => {
    const svc = new BoundedConcurrencyService('s', 2, 2);
    assertEqual(svc.tryAdmit(req('r1', 10_000n), 0n).kind, 'ADMITTED', 'slot 1');
    assertEqual(svc.tryAdmit(req('r2', 10_000n), 0n).kind, 'ADMITTED', 'slot 2');
    assertEqual(svc.tryAdmit(req('r3', 10_000n), 0n).kind, 'QUEUED', 'queue 1');
    assertEqual(svc.tryAdmit(req('r4', 10_000n), 0n).kind, 'QUEUED', 'queue 2');
    assertEqual(svc.tryAdmit(req('r5', 10_000n), 0n).kind, 'REJECTED', 'shed when queue full');
    assertEqual(svc.activeSlots, 2, 'active slots');
    assertEqual(svc.queueDepth, 2, 'queue depth');
  });

  it('promotes the oldest queued request on release', () => {
    const svc = new BoundedConcurrencyService('s', 1, 2);
    svc.tryAdmit(req('r1', 10_000n), 0n);
    svc.tryAdmit(req('r2', 10_000n, 0n), 0n);
    svc.tryAdmit(req('r3', 10_000n, 0n), 0n);

    const release = svc.release('r1', 100n);
    assertEqual(release.kind, 'PROMOTED', 'a queued request must be promoted');
    if (release.kind === 'PROMOTED') {
      assertEqual(release.request.id, 'r2', 'oldest queued request promoted first');
      assertEqual(Number(release.queueWaitUs), 100, 'queue wait measured from enqueue');
    }
  });

  it('accumulates busy time across the whole span, not just local work', () => {
    const svc = new BoundedConcurrencyService('s', 1, 0);
    svc.tryAdmit(req('r1', 1_000_000n), 0n);
    svc.release('r1', 900_000n); // 900ms occupancy: slot held through downstream wait
    assertEqual(
      Number(svc.getSnapshot().busyUsAccumulated),
      900_000,
      'occupancy must cover the entire span',
    );
  });

  it('expires queued requests whose deadline passed', () => {
    const svc = new BoundedConcurrencyService('s', 1, 4);
    svc.tryAdmit(req('active', 10_000_000n), 0n);
    svc.tryAdmit(req('doomed', 500n, 0n), 0n);
    svc.tryAdmit(req('survivor', 10_000_000n, 0n), 0n);

    const expired = svc.expireQueued(1000n);
    assertEqual(expired.length, 1, 'one request should expire');
    assertEqual(expired[0].id, 'doomed', 'the past-deadline request expires');
    assertEqual(svc.queueDepth, 1, 'survivor remains queued');
  });

  it('capacity collapses as occupancy grows (the cascade mechanism)', () => {
    // capacity = concurrency / occupancy. This is arithmetic, not configuration.
    const concurrency = 64;
    const healthyCapacity = concurrency / 0.02; // 20ms  -> 3200 req/s
    const degradedCapacity = concurrency / 0.9; // 900ms ->   71 req/s
    assertClose(healthyCapacity, 3200, 1, 'healthy capacity');
    assertClose(degradedCapacity, 71.1, 1, 'degraded capacity');
    assert(
      healthyCapacity / degradedCapacity > 40,
      'a 45x capacity collapse must follow from occupancy alone',
    );
  });
});

// ---------------------------------------------------------------------------

describe('LogLinearHistogram', () => {
  it('estimates quantiles within the 1% relative-error bound', () => {
    const hist = new LogLinearHistogram();
    const samples: number[] = [];
    for (let i = 1; i <= 10_000; i++) {
      samples.push(i);
      hist.add(i);
    }
    const sorted = [...samples].sort((a, b) => a - b);
    for (const p of [0.5, 0.95, 0.99, 0.999]) {
      const exact = exactQuantile(sorted, p);
      const estimated = hist.quantile(p);
      const errorPct = (Math.abs(estimated - exact) / exact) * 100;
      assert(
        errorPct <= 2.5,
        `p${p * 100} error ${errorPct.toFixed(2)}% exceeded bound (exact=${exact}, est=${estimated})`,
      );
    }
  });

  it('merges: merged histogram matches a histogram of the combined samples', () => {
    const a = new LogLinearHistogram();
    const b = new LogLinearHistogram();
    const combined = new LogLinearHistogram();
    for (let i = 1; i <= 2000; i++) {
      a.add(i);
      combined.add(i);
    }
    for (let i = 2001; i <= 4000; i++) {
      b.add(i);
      combined.add(i);
    }
    a.merge(b);
    for (const p of [0.5, 0.95, 0.99]) {
      assertEqual(a.quantile(p), combined.quantile(p), `merged p${p * 100} must match`);
    }
    assertEqual(a.count, combined.count, 'merged count');
  });

  it('round-trips through its array representation', () => {
    const hist = new LogLinearHistogram();
    for (const v of [10, 100, 1000, 10_000, 100_000]) hist.add(v);
    const restored = LogLinearHistogram.fromArray(hist.toJSON());
    assertEqual(restored.count, hist.count, 'count survives round-trip');
    assertEqual(restored.quantile(0.95), hist.quantile(0.95), 'p95 survives round-trip');
  });
});

describe('SecondBucket quantile quality', () => {
  it('reports EXACT when raw samples are retained', () => {
    const bucket = new SecondBucket('svc', 0n, 0, true);
    for (const v of [10, 20, 30, 40, 50, 60, 70, 80, 90, 100]) bucket.record(v, false);
    const q = bucket.quantiles();
    assertEqual(q.quality, 'EXACT', 'quality label');
    assertEqual(q.p50, 50, 'nearest-rank p50 must be an observed value');
    assertEqual(q.p99, 100, 'nearest-rank p99');
  });

  it('reports ESTIMATED when samples are not retained', () => {
    const bucket = new SecondBucket('svc', 0n, 0, false);
    for (let i = 1; i <= 100; i++) bucket.record(i * 10, false);
    assertEqual(bucket.quantiles().quality, 'ESTIMATED', 'must not claim exactness');
  });

  it('counts failures separately from totals', () => {
    const bucket = new SecondBucket('svc', 0n, 0, true);
    bucket.record(10, false);
    bucket.record(20, true);
    bucket.record(30, true);
    assertEqual(bucket.requestsTotal, 3, 'total');
    assertEqual(bucket.requestsFailed, 2, 'failed');
  });
});

// ---------------------------------------------------------------------------

describe('CanonicalSerializer', () => {
  it('is byte-stable for identical input', () => {
    const build = () =>
      new CanonicalSerializer().str('svc').u32(42).u64(1234n).bool(true).toBuffer();
    assert(build().equals(build()), 'identical input must produce identical bytes');
  });

  it('sorts map keys by UTF-8 bytes, not insertion order', () => {
    const forward = new CanonicalSerializer()
      .sortedMap({ alpha: 1, beta: 2, gamma: 3 }, (s, v) => s.u32(v))
      .toBuffer();
    const reverse = new CanonicalSerializer()
      .sortedMap({ gamma: 3, beta: 2, alpha: 1 }, (s, v) => s.u32(v))
      .toBuffer();
    assert(forward.equals(reverse), 'insertion order must not affect output');
  });

  it('length-prefixes strings so concatenations cannot collide', () => {
    const ab_c = new CanonicalSerializer().str('ab').str('c').toBuffer();
    const a_bc = new CanonicalSerializer().str('a').str('bc').toBuffer();
    assert(!ab_c.equals(a_bc), '("ab","c") must not collide with ("a","bc")');
  });

  it('rejects non-integers in intArray', () => {
    assertThrows(
      () => new CanonicalSerializer().intArray([1, 2.5, 3]),
      'a float in intArray must throw',
    );
  });

  it('distinguishes absent from present-but-empty', () => {
    const absent = new CanonicalSerializer().optional(undefined, (s, v: string) => s.str(v));
    const empty = new CanonicalSerializer().optional('', (s, v: string) => s.str(v));
    assert(!absent.toBuffer().equals(empty.toBuffer()), 'null must differ from empty string');
  });

  // float() is typed `never`, so `s.float(1.5)` is a COMPILE error. The runtime throw
  // below only guards against a caller who defeats the type system with `as never`.
  it('throws if float() is reached at runtime', () => {
    const s = new CanonicalSerializer();
    assertThrows(() => s.float(1.5 as never), 'float() must be unreachable');
  });
});

describe('MerkleHash', () => {
  it('is independent of component insertion order', () => {
    const forward = new Map([
      ['a', 'aa'.repeat(32)],
      ['b', 'bb'.repeat(32)],
    ]);
    const reverse = new Map([
      ['b', 'bb'.repeat(32)],
      ['a', 'aa'.repeat(32)],
    ]);
    assertEqual(
      MerkleHash.compute(forward).root,
      MerkleHash.compute(reverse).root,
      'root must not depend on insertion order',
    );
  });

  it('localizes divergence to a single component', () => {
    const expected = new Map([
      ['service:a', 'aa'.repeat(32)],
      ['service:b', 'bb'.repeat(32)],
    ]);
    const actual = new Map([
      ['service:a', 'aa'.repeat(32)],
      ['service:b', 'cc'.repeat(32)],
    ]);
    assertEqual(
      MerkleHash.firstDivergence(expected, actual),
      'service:b',
      'must name the drifting component',
    );
  });

  it('reports no divergence for identical inputs', () => {
    const m = new Map([['x', 'dd'.repeat(32)]]);
    assertEqual(MerkleHash.firstDivergence(m, m), null, 'identical maps must not diverge');
  });

  it('component hashes differ when content differs', () => {
    const h1 = ComponentHasher.hashBuffer(Buffer.from('one'));
    const h2 = ComponentHasher.hashBuffer(Buffer.from('two'));
    assert(h1 !== h2, 'different content must hash differently');
    assertEqual(h1.length, 64, 'SHA-256 hex length');
  });
});

// ---------------------------------------------------------------------------

describe('State hash', () => {
  const baseState = () => ({
    engineVersion: '0.1.0',
    hashSchemaVersion: HASH_SCHEMA_VERSION,
    clockUs: 1_000_000n,
    eventSeqCounter: 500n,
    services: [
      {
        serviceId: 'payments',
        concurrencyLimit: 32,
        queueCapacity: 256,
        activeSlots: 4,
        queueDepth: 2,
        queuedRequestIds: ['r1', 'r2'],
        admittedTotal: 100,
        completedTotal: 94,
        rejectedTotal: 2,
        expiredInQueueTotal: 0,
        busyUsAccumulated: 5_000_000n,
        occupancyIntegralUs: 6_000_000n,
        lastChangeUs: 1_000_000n,
      },
      {
        serviceId: 'orders',
        concurrencyLimit: 64,
        queueCapacity: 256,
        activeSlots: 1,
        queueDepth: 0,
        queuedRequestIds: [],
        admittedTotal: 100,
        completedTotal: 100,
        rejectedTotal: 0,
        expiredInQueueTotal: 0,
        busyUsAccumulated: 2_000_000n,
        occupancyIntegralUs: 2_000_000n,
        lastChangeUs: 1_000_000n,
      },
    ],
    rngStreams: {
      'service:orders:service_time': {
        name: 'service:orders:service_time',
        initialSeed: 'abc',
        state: 'def',
        drawCount: 100,
      },
    },
  });

  it('is stable across repeated computation', () => {
    assertEqual(
      computeStateHash(baseState()).root,
      computeStateHash(baseState()).root,
      'same state must hash identically',
    );
  });

  it('changes when one service changes, and names that service', () => {
    const before = computeStateHash(baseState());
    const mutated = baseState();
    (mutated.services[0] as { activeSlots: number }).activeSlots = 5;
    const after = computeStateHash(mutated);

    const report = compareStateHashes(before, after);
    assert(report.diverged, 'changing a slot count must change the hash');
    assertEqual(report.component, 'service:payments', 'divergence must name the service');
  });

  it('leaves untouched component hashes unchanged', () => {
    const before = computeStateHash(baseState());
    const mutated = baseState();
    (mutated.services[0] as { activeSlots: number }).activeSlots = 9;
    const after = computeStateHash(mutated);

    assertEqual(
      before.components.get('service:orders'),
      after.components.get('service:orders'),
      'an unrelated service must keep its component hash',
    );
  });

  it('changes when RNG stream position changes', () => {
    const before = computeStateHash(baseState());
    const mutated = baseState();
    mutated.rngStreams['service:orders:service_time'] = {
      name: 'service:orders:service_time',
      initialSeed: 'abc',
      state: 'def',
      drawCount: 101,
    };
    const after = computeStateHash(mutated);
    assert(
      compareStateHashes(before, after).diverged,
      'RNG position is state: a snapshot omitting it cannot replay',
    );
  });

  it('queue order is state: same depth, different order, different hash', () => {
    const before = computeStateHash(baseState());
    const mutated = baseState();
    (mutated.services[0] as { queuedRequestIds: string[] }).queuedRequestIds = ['r2', 'r1'];
    assert(
      compareStateHashes(before, computeStateHash(mutated)).diverged,
      'FIFO order must affect the hash',
    );
  });
});

// ---------------------------------------------------------------------------

describe('WorkloadGenerator', () => {
  const spec = (over: Record<string, unknown>) =>
    ({
      pattern: 'CONSTANT',
      baseRatePerSecond: 100,
      durationUs: 10_000_000n,
      ...over,
    }) as never;

  it('CONSTANT holds its rate for the whole window', () => {
    const g = new WorkloadGenerator(spec({}));
    assertEqual(g.rateAt(0n), 100, 'at t=0');
    assertEqual(g.rateAt(5_000_000n), 100, 'mid-window');
    assertEqual(g.rateAt(10_000_000n), 0, 'after duration the workload is over');
  });

  it('RAMP_UP starts at base and ends at peak', () => {
    const g = new WorkloadGenerator(
      spec({ pattern: 'RAMP_UP', baseRatePerSecond: 0, peakRatePerSecond: 500 }),
    );
    assertEqual(g.rateAt(0n), 0, 'at t=0 -> base');
    assertClose(g.rateAt(5_000_000n), 250, 1, 'halfway -> midpoint');
    assertClose(g.rateAt(9_999_999n), 500, 1, 'at the end -> peak');
  });

  it('RAMP_DOWN starts at peak and ends at base', () => {
    const g = new WorkloadGenerator(
      spec({ pattern: 'RAMP_DOWN', baseRatePerSecond: 0, peakRatePerSecond: 500 }),
    );
    assertEqual(g.rateAt(0n), 500, 'at t=0 -> peak');
    assertClose(g.rateAt(5_000_000n), 250, 1, 'halfway');
  });

  it('SPIKE elevates only inside its pulse window', () => {
    const g = new WorkloadGenerator(
      spec({
        pattern: 'SPIKE',
        baseRatePerSecond: 100,
        peakRatePerSecond: 2000,
        intervalUs: 4_000_000n,
        pulseWidthUs: 1_000_000n,
      }),
    );
    assertEqual(g.rateAt(3_999_999n), 100, 'before the spike');
    assertEqual(g.rateAt(4_000_000n), 2000, 'at spike onset');
    assertEqual(g.rateAt(5_000_000n), 100, 'after the pulse ends');
  });

  it('BURST repeats on its interval', () => {
    const g = new WorkloadGenerator(
      spec({
        pattern: 'BURST',
        baseRatePerSecond: 100,
        peakRatePerSecond: 1000,
        intervalUs: 2_000_000n,
        pulseWidthUs: 500_000n,
      }),
    );
    assertEqual(g.rateAt(0n), 1000, 'first burst');
    assertEqual(g.rateAt(600_000n), 100, 'between bursts');
    assertEqual(g.rateAt(2_000_000n), 1000, 'second burst');
  });

  it('RANDOM is reproducible from the same seed', () => {
    const build = () =>
      new WorkloadGenerator(
        spec({ pattern: 'RANDOM', baseRatePerSecond: 100, peakRatePerSecond: 200 }),
        new SeedableRng(99n).stream('workload:rate'),
      );
    const a = build();
    const b = build();
    for (let i = 0; i < 100; i++) {
      const t = BigInt(i) * 50_000n;
      assertEqual(a.rateAt(t), b.rateAt(t), `RANDOM rate at ${t} must reproduce`);
    }
  });

  it('requires a substream for RANDOM', () => {
    assertThrows(
      () => new WorkloadGenerator(spec({ pattern: 'RANDOM' })),
      'RANDOM without a seeded stream must throw',
    );
  });
});

// ---------------------------------------------------------------------------

describe('ICDF tables', () => {
  it('match the checked-in manifest (guards against engine float drift)', () => {
    const result = new ICDFRegistry().verifyAgainstManifest(ICDF_MANIFEST);
    assert(result.ok, `ICDF drift detected:\n${result.ok ? '' : result.mismatches.join('\n')}`);
  });

  it('throws on an unknown table rather than silently substituting one', () => {
    assertThrows(
      () => new ICDFRegistry().get('does_not_exist'),
      'unknown table must throw, never fall back',
    );
  });

  it('samples deterministically for a given stream position', () => {
    const registry = new ICDFRegistry();
    const table = registry.get('default_service');
    const a = new SeedableRng(5n).stream('t');
    const b = new SeedableRng(5n).stream('t');
    for (let i = 0; i < 200; i++) {
      assertEqual(table.sample(a), table.sample(b), `sample ${i} must reproduce`);
    }
  });

  it('produces only integer microseconds', () => {
    const table = new ICDFRegistry().get('default_service');
    const stream = new SeedableRng(11n).stream('t');
    for (let i = 0; i < 500; i++) {
      const v = table.sample(stream);
      assert(Number.isInteger(v), `sample ${i} must be an integer, got ${v}`);
      assert(v >= 0, `sample ${i} must be non-negative, got ${v}`);
    }
  });
});

await runAll();
