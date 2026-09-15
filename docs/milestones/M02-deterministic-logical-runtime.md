# M02 — Deterministic Logical Runtime

## 1. Context

This is the intellectual core of MIRRORGRID. Every feature after this milestone either consumes
the deterministic engine (experiment replay, state hash verification, comparison engine) or depends
on the guarantees it establishes (metrics exactness, MTTD/MTTR reproducibility).

The central claim: **the numbers are emergent, and the run is reproducible.** Latency, queue growth,
saturation, retry amplification and cascading failure fall out of a bounded-concurrency queueing
model advanced by a virtual clock. Nothing is scripted. Because every source of nondeterminism is
seeded and recorded, the same experiment replays to an identical canonical state hash.

This claim is what separates MIRRORGRID from a dashboard. Retrofitting determinism into a system
that already calls Date.now() and Math.random() across 40 files is effectively a rewrite — which
is why this milestone sits before M03, M04, and M05.

---

## 2. Prerequisites

- M01 gate green (`verify:m1`)
- `--profile core` (Postgres only)

---

## 3. Scope

### In scope
- packages/sim: VirtualClock, event heap, RealtimeDriver, FastDriver, splittable RNG,
  bounded-concurrency queueing model, per-second metrics with raw samples, canonical state hash
- packages/db: migration 003_runtime.sql (experiment_metrics time-series table)
- apps/simulation: LogicalRuntimeAdapter implementing RuntimeAdapter
- apps/web: live metric cards on world overview (polling, WebSocket arrives M08)

### Explicitly out of scope
- ContainerRuntimeAdapter (M03)
- Reliability primitives: CircuitBreaker, RetryPolicy, Bulkhead (M04) — the queueing model
  at M02 uses simplified admission, not full breaker logic. Breakers are added in M04.
- Experiment lifecycle (M05) — this milestone only exposes start/stop via direct adapter calls
- Fault injection (M04)
- WebSocket streaming (M08)

---

## 4. Design

### The cascade mechanism (one rule, no cascade-specific code)

Every service has bounded concurrency and a bounded queue. The load-bearing rule is:

> A concurrency slot is held for the entire request span — including time spent waiting on
> downstream calls, retries and backoff.

That single rule is the whole cascade mechanism, because capacity is then just arithmetic:

```
capacity = concurrency / mean_service_time

Orders, healthy:   64 slots /  20ms  = 3,200 req/s   (500 req/s offered -> 16% utilized)
Orders, degraded:  64 slots / 900ms  =    71 req/s   (500 req/s offered -> collapsed)
```

Nothing was reconfigured. Orders' capacity fell 45x because a slow dependency made it hold each
slot longer. Retry amplification emerges from this same rule with no additional code.

### Float determinism — the hardest constraint

IEEE-754 `+ - * /` are reproducible across V8 versions and platforms. `Math.log`, `Math.exp`, and
`Math.pow` are **not** guaranteed to the last ULP. One ULP can cross an integer-microsecond boundary,
reorder two heap events, and diverge everything downstream.

**Resolution:** distributions are sampled from pre-generated integer inverse-CDF tables, not computed.
- Table generation runs offline and may use `Math.log` freely; the *output integers* are the contract.
- The table is hashed into `engine_version`; for user-supplied parameters the table bytes are stored
  in the run's frozen config so a replay uses the original table rather than regenerating it.
- Time is integer microseconds throughout (exact below 2^53 = 285 years of range).
- Probabilities are fixed-point integers in parts-per-billion; an error roll is an integer
  comparison against a precomputed threshold.
- Token buckets hold integer micro-tokens, so no drift accumulates over a long run.
- Any user-supplied float is quantized **once at the config boundary**; NaN/Infinity are rejected.

`Date.now()` and `Math.random()` are banned inside `packages/sim` by ESLint `no-restricted-globals`.
This ban is why the guarantee survives contact with a deadline.

### Splittable PRNG — substream isolation

A root seed derives named substreams by hashing the stream name with the seed:
`rng.stream('workload:gateway')`, `rng.stream('service:payments:latency')`.

**The non-obvious requirement:** without substream isolation, adding a new random consumer anywhere
shifts every downstream draw and silently invalidates comparison against earlier experiments. With
splittable streams, adding a new consumer creates a new substream and leaves existing ones
unchanged. This is tested directly (gate assertion 3).

### Virtual clock — two drivers, one engine

A binary-heap event queue ordered by `(time, priority, sequence)` — a *total* order, so simultaneous
events are never ambiguously ordered. The `sequence` field breaks ties deterministically.

- **RealtimeDriver:** paces advancement to 1x wall clock for the live UI. When it falls behind
  (a 5,000 rps burst on a laptop) it executes the backlog as fast as it can — it never drops,
  reorders, coalesces or skips events. Lag is surfaced in the UI as a honesty indicator.
- **FastDriver:** drains the heap as fast as possible for replay and CI (~1000x difference in runtime).

**Invariant — the realtime driver controls the *rate* of advancement and nothing else.**
VirtualClock remains the sole authority on simulation time. No wall-clock value ever enters model
state, influences a branch, or reaches the hash. Driver equivalence is asserted directly by
gate 7 (same run, same hash under both drivers).

### Canonical state hash — Merkle, not flat

Each component (a service, an edge, the event heap, the RNG registry, the fault set) is hashed
independently and the root is the hash of the sorted `(key, componentHash)` pairs.

- Serialization is length-prefixed binary with sorted map keys (sorted by UTF-8 bytes, never
  `localeCompare`) — not JSON, whose number formatting is lossy and key order is only conventionally stable.
- The canonical serializer's `float()` method is typed as `never` — passing a float is a compile error.
- Merkle structure enables **checkpoint bisection**: divergence can be binary-searched to the first
  bad checkpoint, then component hashes name the exact service or edge that drifted.

### Metric representation (two modes, honestly labelled)

| Mode | Storage | Quantile quality |
|---|---|---|
| LOGICAL, active or < 7 days old | Raw latency samples `int[]` of microseconds | **Exact** P50/P95/P99/P99.9 |
| CONTAINER / platform / > 7 days old | Log-linear histogram bucket counts `int[]` | **Bounded relative error** (±1% with gamma=1.02), mergeable |

LOGICAL mode retains raw samples because volume is controlled and deterministic, and exactness is
what makes two replayed runs comparable at the quantile level. The histogram's real virtue is
mergeability — bucket arrays sum across seconds and services and still yield a valid quantile, which
averaging pre-computed percentiles cannot.

---

## 5. Data Model

### Migration 003_runtime.sql

```sql
-- Experiment runs (lightweight at M02; more columns added in M05)
CREATE TABLE experiment_runs (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  world_id        UUID NOT NULL REFERENCES worlds(id) ON DELETE CASCADE,
  seed            BIGINT NOT NULL,
  runtime_mode    TEXT NOT NULL CHECK (runtime_mode IN ('LOGICAL','CONTAINER','HYBRID')),
  engine_version  TEXT NOT NULL,
  schema_version  INT NOT NULL DEFAULT 1,
  git_commit      TEXT,
  lockfile_hash   TEXT,
  frozen_config   JSONB NOT NULL,
  config_hash     TEXT NOT NULL,
  final_state_hash TEXT,  -- NULL for CONTAINER/HYBRID (enforced by constraint in M05)
  status          TEXT NOT NULL DEFAULT 'CREATED'
                  CHECK (status IN ('CREATED','RUNNING','COMPLETED','FAILED','CANCELLED')),
  started_at      TIMESTAMPTZ,
  completed_at    TIMESTAMPTZ,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX experiment_runs_world_idx    ON experiment_runs (world_id, status);
CREATE INDEX experiment_runs_created_idx  ON experiment_runs (created_at DESC);

-- Per-second metric buckets (partitioned by run for archival)
CREATE TABLE experiment_metrics (
  id              BIGSERIAL,
  run_id          UUID NOT NULL REFERENCES experiment_runs(id) ON DELETE CASCADE,
  service_id      UUID NOT NULL REFERENCES services(id) ON DELETE CASCADE,
  virtual_time_us BIGINT NOT NULL,   -- WORLD_VIRTUAL: microseconds from run start
  wall_time_ms    BIGINT NOT NULL,   -- PLATFORM_WALL: for ordering only, never hashed
  requests_total  INT NOT NULL DEFAULT 0,
  requests_failed INT NOT NULL DEFAULT 0,
  queue_depth     INT NOT NULL DEFAULT 0,
  active_slots    INT NOT NULL DEFAULT 0,
  circuit_state   TEXT CHECK (circuit_state IN ('CLOSED','OPEN','HALF_OPEN')),
  -- LOGICAL mode: raw samples for exact quantiles
  latency_samples_us INT[],
  -- All modes: mergeable histogram
  latency_histogram  INT[],
  PRIMARY KEY (id, run_id)
) PARTITION BY LIST (run_id);

-- Default partition for runs that haven't been partitioned yet
CREATE TABLE experiment_metrics_default PARTITION OF experiment_metrics DEFAULT;

CREATE INDEX experiment_metrics_run_service_time_idx
  ON experiment_metrics (run_id, service_id, virtual_time_us);
```

**Partition strategy:** one partition per experiment run, created when the run starts. Old partitions
are archived to MinIO (M11) and then dropped — so the hot table never accumulates stale data.

---

## 6. Packages

### packages/sim (zero runtime dependencies — CI-enforced)

```
src/
  clock/
    virtual-clock.ts       VirtualClock: now(), advance(us), schedule(event), drain()
    event-heap.ts          MinHeap ordered by (timeUs, priority, seq): BinaryHeap<SimEvent>
    realtime-driver.ts     RealtimeDriver: paces advancement to 1x wall clock
    fast-driver.ts         FastDriver: drains heap as fast as possible
    types.ts               SimEvent, ClockDriver interface, EventPriority enum
  rng/
    rng.ts                 SeedableRng: root seed, stream(name): SubStream
    substream.ts           SubStream: nextUint32(), nextFloat01(), nextIntRange(min,max),
                           bernoulliTrial(thresholdPpb): bool
    splitter.ts            deriveStreamSeed(rootSeed, streamName): bigint (FNV-1a hash)
  queueing/
    service-model.ts       BoundedConcurrencyService: tryAdmit(nowUs), release(slot, outcomeUs)
    queue.ts               BoundedQueue<T>: enqueue, dequeue, depth, capacity
    scheduler.ts           SimScheduler: schedules arrivals, departures, metrics flush
    cascade.ts             CascadeDetector: occupancy tracking, backpressure signals
  metrics/
    bucket.ts              SecondBucket: accumulates samples in a 1s window
    histogram.ts           LogLinearHistogram: gamma=1.02, 512 buckets, add(valueUs),
                           merge(other), quantile(p): number, toArray(), fromArray()
    collector.ts           MetricsCollector: per-service per-second buckets, flush to DB
  hash/
    canonical.ts           CanonicalSerializer: length-prefixed binary, sorted keys
                           float() typed as never (compile error)
    hasher.ts              ComponentHasher: SHA-256 of canonical bytes
    merkle.ts              MerkleHash: hash sorted (key, componentHash) pairs
  workload/
    generator.ts           WorkloadGenerator: CONSTANT/RAMP_UP/RAMP_DOWN/BURST/SPIKE/RANDOM
                           schedules arrivals via VirtualClock events
    arrival.ts             ArrivalScheduler: Poisson arrivals from seeded RNG
  icdf/
    exponential.ts         Precomputed ICDF table: exponential(lambda) -> int[] of microseconds
    normal.ts              Precomputed ICDF table: truncated normal -> int[] of microseconds
    lognormal.ts           Precomputed ICDF table: lognormal -> int[] of microseconds
    bimodal.ts             Precomputed ICDF table: bimodal (healthy + tail) distribution
    loader.ts              loadTable(name, params): ICDFTable from bundled tables
  engine/
    sim-engine.ts          SimEngine: owns VirtualClock, all ServiceModels, MetricsCollector,
                           dispatches events; exposes run(handle, workload), pause(), stop()
    world-state.ts         WorldState: canonical representation of all services, edges, RNG positions
    state-hash.ts          computeStateHash(worldState): string (the canonical state hash)
  index.ts
```

### apps/simulation

```
src/
  adapters/
    logical-runtime.adapter.ts   LogicalRuntimeAdapter implements RuntimeAdapter
  engine/
    engine-pool.ts               Map<worldId, SimEngine>; lifecycle management
  api/
    simulation.routes.ts         POST /runs, POST /runs/:id/start, POST /runs/:id/stop,
                                 GET  /runs/:id/status, GET /runs/:id/metrics
    simulation.controller.ts
    simulation.service.ts
    simulation.repository.ts     writes to experiment_runs, experiment_metrics
    simulation.schema.ts
  app.ts
  server.ts
```

---

## 7. Interfaces

### Clock (packages/domain, shared by sim and reliability)

```typescript
// packages/domain/src/runtime/clock.ts
export interface Clock {
  /** Current time in microseconds. For VirtualClock: WORLD_VIRTUAL. For SystemClock: PLATFORM_WALL. */
  nowUs(): bigint;
  /** Domain tag — prevents mixing virtual and wall times. */
  readonly domain: 'WORLD_VIRTUAL' | 'PLATFORM_WALL';
}
```

### SimEngine

```typescript
// packages/sim/src/engine/sim-engine.ts
export interface SimEngineConfig {
  readonly worldSpec: WorldSpec;
  readonly seed: bigint;
  readonly driver: ClockDriver;
  readonly metricsFlushIntervalUs: bigint;
}

export class SimEngine {
  constructor(config: SimEngineConfig) {}
  async run(): Promise<void>;
  pause(): void;
  resume(): void;
  stop(): void;
  getStateHash(): string;
  getWorldState(): WorldState;
  /** For use by LogicalRuntimeAdapter's observe() only */
  readonly samples$: AsyncIterable<RuntimeSample>;
}
```

### ICDFTable

```typescript
// packages/sim/src/icdf/loader.ts
export interface ICDFTable {
  readonly name: string;
  readonly params: Record<string, number>;
  readonly buckets: Int32Array;   // microseconds
  readonly hash: string;          // SHA-256 of buckets — included in engine_version
  sample(rng: SubStream): number; // returns integer microseconds
}
```

---

## 8. API

```
POST   /api/v1/simulation/runs
  body: { worldId, seed, runtimeMode: 'LOGICAL', workloadId }
  -> 201 { data: { runId, status: 'CREATED' } }

POST   /api/v1/simulation/runs/:runId/start
  -> 202 { data: { runId, status: 'RUNNING' } }

POST   /api/v1/simulation/runs/:runId/stop
  -> 202 { data: { runId, status: 'STOPPING' } }

GET    /api/v1/simulation/runs/:runId/status
  -> 200 { data: { runId, status, engineVersion, seed, startedAt, completedAt, stateHash? } }

GET    /api/v1/simulation/runs/:runId/metrics
  ?serviceId&from&to&resolution
  -> 200 { data: MetricBucket[] }
  Each bucket: { virtualTimeUs, serviceId, p50, p95, p99, errorRate, queueDepth, activeSlots }
  Note: p* values are exact (raw samples) for LOGICAL mode; estimated (histogram) for CONTAINER.
        The response includes a `quantileQuality: 'EXACT' | 'ESTIMATED'` field — never silent.
```

---

## 9. UI

### World overview — live metric cards (spec §14)

At M02, the world overview gains real-time metric cards populated by polling `/metrics`:
- P95 latency (labelled EXACT or ESTIMATED)
- Error rate
- Throughput (req/s)
- Queue depth

Cards update every 2 seconds (polling). WebSocket arrives in M08.

**The cascade is visible here.** When Payments slows, its queue depth card turns amber, then red.
Orders' P95 card rises. Gateway's throughput card drops. No scripting — it falls out of the model.

### Topology during a run
- Nodes animate: slot utilization shown as a fill ring (0% = empty, 100% = saturated = red)
- Edge thickness increases with traffic, dims to gray when a circuit is OPEN

---

## 10. Steps

1. **packages/sim/src/clock** — VirtualClock, event heap (min-heap), SimEvent types.
2. **packages/sim/src/rng** — splittable RNG, substreams, FNV-1a splitter.
3. **ICDF tables** — generate offline for exponential, normal, lognormal, bimodal distributions.
   Bundle as `packages/sim/src/icdf/tables/*.json`. Hash each into `engine_version`.
4. **packages/sim/src/queueing** — BoundedConcurrencyService, BoundedQueue, scheduler.
5. **packages/sim/src/metrics** — SecondBucket, LogLinearHistogram, MetricsCollector.
6. **packages/sim/src/hash** — CanonicalSerializer, ComponentHasher, MerkleHash.
7. **packages/sim/src/workload** — WorkloadGenerator for all 6 patterns.
8. **packages/sim/src/engine** — SimEngine, WorldState, state-hash computation.
9. **drivers** — RealtimeDriver (paces to 1x) and FastDriver (drains).
10. **Migration 003_runtime.sql** + Drizzle schema extensions.
11. **apps/simulation** — LogicalRuntimeAdapter, engine pool, routes.
12. **apps/web** — metric cards on world overview, polling `/metrics`.
13. **verify:determinism script** — all 7 gate assertions.

---

## 11. Testing

### Unit (packages/sim — all deterministic)
- VirtualClock: schedule 100 events at various times -> drains in correct order
- EventHeap: simultaneous events ordered by (priority, sequence) not by insertion
- Splittable RNG:
  - Same seed -> identical sequence
  - Different seed -> different sequence
  - Add new substream -> existing substreams unchanged (substream isolation)
- BoundedConcurrencyService:
  - tryAdmit returns false when at capacity
  - release decrements active_slots
  - Occupancy * concurrency_limit >= capacity (Little's Law sanity check)
- LogLinearHistogram:
  - add(v) + quantile(0.95) matches brute-force quantile within 1.02x
  - merge: sum of two histograms yields same quantile as merged raw samples
- CanonicalSerializer: float() is a TypeScript compile error (enforced by type test)
- StateHash: changing one service's slot count changes the hash; other services unchanged
- WorkloadGenerator: RAMP_UP at t=0 -> base_rate; at t=duration -> peak_rate

### Determinism tests (the gate)
- Same seed, two runs -> identical state hashes (100 trial seeds)
- Different seed -> different hash
- Substream isolation (new stream, old streams unchanged)
- Little's Law on steady-state fixture (see gate assertion 4)
- Scale: 1,000 services, 5,000 req/s, FastDriver, < 60s
- RealtimeDriver: 1x wall clock within 5% over 2 minutes
- FastDriver == RealtimeDriver: same hash

### Integration
- POST /simulation/runs -> run created in DB
- Start + stop -> status transitions correctly
- Metrics written to experiment_metrics; quantile computation matches raw samples

---

## 12. Gate

```bash
npm run verify:determinism
```

1. **Identical state hashes:** Run the §10 topology (500 req/s, seed=42) twice with FastDriver
   -> state hashes are byte-identical.
2. **Seed sensitivity:** Same topology, seed=43 -> hash differs from seed=42.
3. **Substream isolation:** Run with streams [A, B]. Add stream C. Streams A and B produce
   identical values to the no-C run for the first 10,000 draws each.
4. **Little's Law (steady-state fixture only):**
   - CONSTANT workload at 200 req/s, single service, 20ms service time, 5% warm-up discarded,
     60s measurement window.
   - Assert: `L (mean_queue_depth) ≈ lambda * W (mean_latency_s)` within 2%.
   - This fixture is **isolated from burst, startup, failure, recovery** — all of which violate
     the stable-system assumption. Transient scenarios are explicitly excluded from this check.
5. **Scale:** 1,000 logical services at 5,000 req/s completes in FastDriver in under 60s.
6. **Realtime driver fidelity:** RealtimeDriver holds 1x wall clock within 5% drift over 2 minutes.
7. **Driver equivalence:** Same world, same seed, FastDriver vs RealtimeDriver -> identical state hash.

---

## 13. Pitfalls

- **Calling Math.log/exp/pow on the hot path.** The float-determinism analysis makes this fatal.
  Use the ICDF tables. The ESLint ban on `Math.random` is already in place; add `Math.log`,
  `Math.exp`, `Math.pow` to `no-restricted-globals` inside `packages/sim`.

- **JSON for canonical serialization.** JSON number formatting is lossy (`1e-7` vs `0.0000001`)
  and key order is only conventionally stable across V8 versions. Use length-prefixed binary.

- **Measuring Little's Law on a run that includes startup or fault injection.** Little's Law
  requires a stable system. The gate fixture uses a dedicated steady-state workload with a
  discarded warm-up period — never the flagship experiment.

- **RealtimeDriver dropping events when behind.** It must execute the backlog at full speed when
  it falls behind — never skip or coalesce events. The hash must match the FastDriver run.

- **Forgetting to checkpoint RNG positions.** When writing WorldState for hashing or snapshotting,
  each SubStream's current position must be included. A restored state that loses RNG positions
  will diverge immediately.

- **Float leaking through reporting.** Floats appear only at the reporting boundary (chart payloads).
  The rule is: integer counters in, floats out — and the floats are never fed back in.

---

## 14. Done

- [ ] `npm run verify:determinism` passes all 7 assertions
- [ ] `packages/sim` has zero runtime dependencies (CI-enforced by dependency-cruiser)
- [ ] `Date.now()` and `Math.random()` banned in packages/sim (ESLint, verified by test)
- [ ] `CanonicalSerializer.float()` is typed `never` (compile error if used)
- [ ] All 6 workload patterns produce correct arrival schedules (unit tested)
- [ ] Little's Law holds on the steady-state fixture within 2%
- [ ] FastDriver and RealtimeDriver produce identical state hashes
- [ ] Cascade is visible in the world overview metric cards during a run
- [ ] `docs/adr/004-float-determinism-icdf-tables.md` written
- [ ] `docs/adr/005-virtual-clock-two-drivers.md` written
- [ ] ICDF table hashes committed to `packages/sim/src/icdf/manifest.json`
