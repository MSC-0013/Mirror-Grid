# M13 — Performance, Hardening, and the Final Chaos Campaign

## 1. Context

This is the capstone milestone of the MIRRORGRID project.

Across M00 through M12, MIRRORGRID was constructed layer by layer:

- The foundational domain model and topology graph (M01).
- The deterministic logical simulator with virtual clock and state hashes (M02).
- The dual runtime peers: Docker containers (M03) and Kubernetes (M12).
- The formal reliability state machines and fault engine (M04).
- The experiment engine and flagship cascading collapse demo (M05).
- Enterprise hardening: RBAC, audit logs, async jobs, Kafka events, observability, and SRE SLO/RCA (M06–M11).

The final milestone is the **Performance Hardening and Certification Campaign**.
This milestone subjects the entire platform to an adversarial, multi-hour endurance and stress campaign:

1. **10,000 Req/Sec High-Throughput Load Testing:** Pushing the API Gateway and synthetic microservices to their physical limits.
2. **24-Hour Soak & Memory Leak Audit:** Verifying zero memory drift and flat RSS heap profiles via automated V8 heap snapshot diffing.
3. **Adversarial Mutational Fuzzing:** Generating thousands of malformed payloads, corrupt timestamps, and boundary conditions to ensure zero unhandled crashes.
4. **The Ultimate Chaos Campaign:** A continuous barrage of randomized network partitions, CPU throttles, and container restarts across 100 concurrent worlds.

Passing the final gate (`npm run verify:campaign`) produces the **Certification Artifact**: mathematical
proof that MIRRORGRID is production-grade, highly performant, and resilient under extreme conditions.

---

## 2. Prerequisites

- Milestones M00 through M12 all green (`verify:m0` through `verify:ha`)
- Docker Compose profile: `--profile full` (All services, Kafka, Redis, Postgres, Prometheus)

---

## 3. Scope

### In scope

- `packages/campaign`: High-throughput load generator (`undici.Pool`), V8 heap snapshot leak detector,
  adversarial mutation fuzzer, and campaign orchestrator.
- High-Throughput Workload Generator capable of generating 10,000+ req/s with bounded client overhead.
- Automated Memory Leak Detector: Programmatic V8 heap snapshot capture and retained object differential analysis.
- Mutational Fuzz Testing: Random byte, timestamp, and JSON boundary mutations tested against event and reliability parsers.
- Multi-World Stress Test: Orchestrating 100 concurrent simulated worlds running simultaneously without degradation.
- Database migration `014_campaign.sql`: `campaign_runs`, `campaign_metrics`, `campaign_leaks`.
- UI: Chaos Campaign Command Center (§80), live RPS odometer, 24h memory sparkline, and Final Certification Badge.
- Final Certification Gate: `npm run verify:campaign`.

### Explicitly out of scope

- Distributed multi-region load testing across multiple physical datacenters.
- Physical hardware power disruption testing.

---

## 4. Design

### High-Throughput Workload Generation with `undici`

Standard Node.js `fetch` or Axios incurs significant allocation overhead per request, bottlenecking
load generators at ~2,000 req/s.

MIRRORGRID builds a dedicated workload generator using **`undici.Pool`**:

- Connection pooling with HTTP/1.1 pipelining and keep-alive socket reuse.
- Zero-copy stream consumption.
- Multi-threaded worker pool (`node:worker_threads`) pinning 4 worker threads to dedicated CPU cores.
- Generates 10,000+ req/s sustained on a standard developer workstation with client CPU utilization $< 15\%$.

### Automated V8 Heap Snapshot Differential Analysis

Memory leaks in long-running Node.js distributed systems usually stem from:

- Event listener accumulation (`EventEmitter.on` without `.off`).
- Unbounded in-memory maps or caches without TTL/eviction.
- Closures holding references to old request spans.

MIRRORGRID automates leak detection using the V8 inspector:

```typescript
// packages/campaign/src/leak/leak-detector.ts
import v8 from 'node:v8';

export async function detectMemoryLeak(fn: () => Promise<void>, iterations: number) {
  // 1. Warmup and initial GC
  await fn();
  global.gc?.();
  const baselineSnapshot = captureHeapMap();

  // 2. Execute heavy workload
  for (let i = 0; i < iterations; i++) {
    await fn();
  }

  // 3. Force garbage collection and take second snapshot
  global.gc?.();
  const finalSnapshot = captureHeapMap();

  // 4. Diff object retainers
  const diff = compareSnapshots(baselineSnapshot, finalSnapshot);
  return diff.retainedGrowthBytes <= ALLOWED_SLACK_BYTES;
}
```

If object counts for `TraceSpan`, `CircuitBreakerCore`, or `AsyncJob` grow monotonically across iterations,
the test fails and outputs the exact constructor and retaining path.

### Adversarial Mutational Fuzzing

To ensure the reliability engine and event parsers never crash on unexpected inputs:

- Generates 10,000 mutated inputs:
  - Header mutations: Negative deadlines (`mg-deadline-at: -500`), future timestamps ($2^{53} - 1$), malformed W3C traceparents.
  - JSON mutations: Deeply nested objects (depth 100+), NaN/Infinity values, prototype pollution attacks (`__proto__`).
  - Integer overflow attacks: Parts-per-million values $> 1,000,000$ or $< 0$.
- Invariant: **Zero unhandled exceptions or process terminations**. Every malformed input must be cleanly
  rejected with a standardized `AppError.validation()` envelope.

### The 24-Hour Chaos Campaign Orchestrator

The campaign runs a continuous cycle of coordinated stress:

```
[ Phase 1: Baseline Load (2,000 RPS) ]
                  |
                  v
[ Phase 2: High Surge (10,000 RPS for 15 mins) ]
                  |
                  v
[ Phase 3: Chaos Injections (Random Breaker Trips, Latencies, Pod Kills) ]
                  |
                  v
[ Phase 4: Self-Healing & Drain (Cooldown to 500 RPS) ]
                  |
                  v
[ Evaluate Invariants: State Hash Determinism, Zero Leaks, Zero Deadlocks ]
```

---

## 5. Data Model

Full DDL for migration `packages/db/src/migrations/014_campaign.sql`:

```sql
-- 014_campaign.sql: Chaos Campaign executions, soak telemetry, and leak diagnostics

-- 1. Campaign Runs execution master table
CREATE TABLE campaign_runs (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    name VARCHAR(120) NOT NULL,
    campaign_type VARCHAR(50) NOT NULL,    -- 'THROUGHPUT_BURST', 'SOAK_24H', 'ADVERSARIAL_FUZZ', 'FULL_CAMPAIGN'
    target_rps INTEGER NOT NULL DEFAULT 10000,
    duration_seconds INTEGER NOT NULL,
    total_requests_executed BIGINT NOT NULL DEFAULT 0,
    successful_requests BIGINT NOT NULL DEFAULT 0,
    failed_requests BIGINT NOT NULL DEFAULT 0,
    p50_latency_ms NUMERIC(8, 3),
    p99_latency_ms NUMERIC(8, 3),
    peak_memory_mb NUMERIC(8, 2),
    memory_drift_mb NUMERIC(8, 2) DEFAULT 0,
    status VARCHAR(30) NOT NULL DEFAULT 'RUNNING', -- RUNNING, CERTIFIED, FAILED, ABORTED
    certification_hash VARCHAR(64),
    started_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    completed_at TIMESTAMPTZ
);

CREATE INDEX idx_campaign_runs_status ON campaign_runs(status, started_at DESC);

-- 2. Time-series telemetry snapshots during soak tests
CREATE TABLE campaign_metrics (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    campaign_id UUID NOT NULL REFERENCES campaign_runs(id) ON DELETE CASCADE,
    elapsed_seconds INTEGER NOT NULL,
    current_rps INTEGER NOT NULL,
    latency_p99_ms NUMERIC(8, 3) NOT NULL,
    heap_used_mb NUMERIC(8, 2) NOT NULL,
    rss_mb NUMERIC(8, 2) NOT NULL,
    event_loop_lag_ms NUMERIC(6, 2) NOT NULL,
    active_handles INTEGER NOT NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_campaign_metrics_time ON campaign_metrics(campaign_id, elapsed_seconds ASC);

-- 3. Fuzzing anomalies and crash reports
CREATE TABLE campaign_fuzz_anomalies (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    campaign_id UUID NOT NULL REFERENCES campaign_runs(id) ON DELETE CASCADE,
    mutation_type VARCHAR(80) NOT NULL,
    input_payload JSONB NOT NULL,
    response_code INTEGER,
    error_message TEXT,
    is_fatal BOOLEAN NOT NULL DEFAULT FALSE,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_fuzz_anomalies_campaign ON campaign_fuzz_anomalies(campaign_id);
```

### Index rationale

- `idx_campaign_runs_status`: Instant retrieval of past certification records.
- `idx_campaign_metrics_time`: Powers the 24-hour soak test telemetry sparkline in the UI.

---

## 6. Packages

```
packages/campaign/
├── package.json
├── tsconfig.json
├── src/
│   ├── index.ts                     # Public campaign API
│   ├── load/
│   │   ├── undici-generator.ts      # Multi-worker 10k RPS load generator
│   │   └── rps-controller.ts        # Dynamic load curves (sine, surge, step)
│   ├── leak/
│   │   ├── heap-inspector.ts        # V8 heap snapshot differential analyzer
│   │   └── handle-tracker.ts        # Active timer and socket handle auditor
│   ├── fuzz/
│   │   ├── mutator.ts               # Payload, header, and boundary fuzzer
│   │   └── fuzz-runner.ts           # Invariant fuzz executor
│   └── orchestrator/
│       ├── campaign-runner.ts       # Multi-stage chaos campaign coordinator
│       └── certifier.ts             # Cryptographic certification hash generator
packages/db/
├── src/
│   ├── schema/
│   │   └── campaign.ts              # Drizzle schema matching 014_campaign.sql
│   └── migrations/
│       └── 014_campaign.sql         # Migration DDL above
apps/control/
├── src/
│   └── modules/
│       └── campaign/
│           ├── campaign.routes.ts   # Campaign launch, status, and abort routes
│           ├── campaign.controller.ts
│           └── campaign.service.ts
apps/web/
├── src/
│   └── app/
│       └── campaign/
│           ├── page.tsx             # Chaos Campaign Command Center (§80)
│           └── certificate/
│               └── page.tsx         # Performance & Reliability Certification Badge
```

---

## 7. Interfaces

### Campaign and Load Generator Contracts

```typescript
// packages/campaign/src/load/undici-generator.ts

export interface LoadGeneratorConfig {
  readonly targetUrl: string;
  readonly targetRps: number;
  readonly durationSeconds: number;
  readonly concurrency: number;
  readonly workerThreads: number;
  readonly headers?: Record<string, string>;
}

export interface LoadTelemetrySample {
  readonly currentRps: number;
  readonly p50Ms: number;
  readonly p95Ms: number;
  readonly p99Ms: number;
  readonly totalErrors: number;
  readonly eventLoopLagMs: number;
}

export interface LoadGenerator {
  start(): Promise<void>;
  stop(): Promise<void>;
  onSample(callback: (sample: LoadTelemetrySample) => void): void;
}
```

### Memory Leak Auditor Contract

```typescript
// packages/campaign/src/leak/heap-inspector.ts

export interface MemoryAuditResult {
  readonly baselineHeapMb: number;
  readonly finalHeapMb: number;
  readonly driftMb: number;
  readonly isLeakDetected: boolean;
  readonly topRetainedConstructors: readonly {
    readonly constructorName: string;
    readonly retainedCount: number;
    readonly sizeDeltaBytes: number;
  }[];
}

export interface LeakDetector {
  auditOperation(fn: () => Promise<void>, iterations: number): Promise<MemoryAuditResult>;
}
```

---

## 8. API

Routes in `apps/control` under `/api/v1/campaign`.

### 1. Launch Chaos Campaign

- `POST /api/v1/campaign/start`
- **Request Body (zod schema):**
  ```typescript
  export const startCampaignSchema = z.object({
    name: z.string().min(1).max(120),
    type: z.enum(['THROUGHPUT_BURST', 'SOAK_24H', 'ADVERSARIAL_FUZZ', 'FULL_CAMPAIGN']),
    targetRps: z.number().int().positive().default(10000),
    durationSeconds: z.number().int().positive().default(300),
  });
  ```
- **Response:** `202 Accepted` with `{ campaignId: string, status: 'RUNNING' }`.

### 2. Get Campaign Telemetry

- `GET /api/v1/campaign/:id/telemetry`
- **Response:** `200 OK` with live RPS, latency percentiles, memory usage, and active anomalies.

### 3. Abort Campaign

- `POST /api/v1/campaign/:id/abort`
- **Response:** `200 OK` with `{ status: 'ABORTED' }`.

### 4. Fetch Certification Artifact

- `GET /api/v1/campaign/:id/certificate`
- **Response:** `200 OK` with signed cryptographic certification document.

---

## 9. UI

### 1. Chaos Campaign Command Center (`apps/web/src/app/campaign/page.tsx`)

- **Spec alignment:** §80 (Chaos Campaign Command Center).
- **Layout:**
  - **Top Banner (Mission Control Style):**
    - Large digital RPS Odometer (`10,240 REQ/SEC`).
    - Campaign Status: Pulsing Green `CAMPAIGN ACTIVE — STAGE 3/4`.
    - Elapsed Time / Duration (`02:14:32 / 24:00:00`).
  - **Main Dashboard Grid:**
    - **Chart 1 (Throughput & Latency):** Offered vs Completed RPS with overlaid P99 latency line.
    - **Chart 2 (Memory Soak Telemetry):** 24-hour RSS / Heap memory sparkline demonstrating rock-flat profile.
    - **Chart 3 (Event Loop Health):** Event loop latency gauge (Green `< 5ms`, Amber `5-20ms`, Red `> 20ms`).
  - **Active Chaos Disruptions Feed:** Live ticker showing automated faults currently battering the system.

### 2. Final Certification Badge (`apps/web/src/app/campaign/certificate/page.tsx`)

- **Visuals:**
  - Official MIRRORGRID Reliability & Performance Certification Card.
  - Highlights:
    - Peak Throughput: `10,482 RPS`
    - P99 Tail Latency: `< 48ms`
    - Soak Test Drift: `< 2.4 MB (Zero Leak Certified)`
    - Fuzz Invariant Violations: `0 / 10,000`
    - Cryptographic Verification Signature (SHA-256).

---

## 10. Steps

1. **Create `packages/campaign` package:** Setup undici, v8 inspector types, and tsconfig.
2. **Build High-Throughput Load Generator:** Implement `undici.Pool` multi-threaded worker generator.
3. **Build V8 Heap Snapshot Leak Auditor:** Implement programmatic snapshot diffing and constructor counting.
4. **Build Mutational Fuzz Engine:** Implement boundary generator for headers, payloads, and timestamps.
5. **Build 100-World Multi-Tenant Stress Harness:** Implement coordinator running 100 concurrent worlds.
6. **Implement Campaign Orchestrator:** Coordinate multi-stage chaos campaigns.
7. **Database migration `014_campaign.sql`:** Apply schema and partial indexes in Postgres.
8. **Build Control Plane Campaign modules:** Register endpoints for campaign launch, telemetry, and abort.
9. **Build Chaos Campaign Command Center UI:** Implement `apps/web/src/app/campaign/page.tsx`.
10. **Build Certification Badge UI:** Implement `apps/web/src/app/campaign/certificate/page.tsx`.
11. **Implement `npm run verify:campaign` gate script:** The ultimate portfolio certification test suite.
12. **Compile Final Portfolio Release:** Run full test campaign and certify repo readiness.

---

## 11. Testing

### Unit tests (`packages/campaign/tests/unit`)

- `mutator.test.ts`: Verify generated fuzzed payloads cover negative integers, overflow bounds, and malformed strings.
- `leak-inspector.test.ts`:
  - Run intentional leak (appending to global array); assert `detectMemoryLeak` flags `isLeakDetected = true`.
  - Run clean function; assert `detectMemoryLeak` flags `isLeakDetected = false`.

### Performance Stress Benchmark (`packages/campaign/tests/benchmark`)

- Spin up synthetic gateway and services.
- Flood with 10,000 req/s for 60 seconds.
- Assert generator achieves target throughput with zero dropped sockets.

---

## 12. Gate

Command: `npm run verify:campaign`

The final gate script validates these 5 ultimate performance and reliability assertions:

```typescript
// tests/gates/verify-campaign.ts

// Assertion 1: Workload generator sustains >= 10,000 requests/sec with P99 < 50ms
assert(
  sustainedRps >= 10000 && p99LatencyMs <= 50.0,
  'Assertion 1: 10,000 req/s throughput sustained with sub-50ms tail latency',
);

// Assertion 2: Memory soak test certifies zero memory leaks (RSS growth < 5MB after 100k requests)
assert(
  memoryDriftMb <= 5.0 && !leakDetected,
  'Assertion 2: Zero memory leaks certified via V8 heap snapshot diffing',
);

// Assertion 3: Event loop lag remains <= 20ms under maximum load
assert(
  maxEventLoopLagMs <= 20.0,
  'Assertion 3: Event loop remains unblocked and responsive under extreme load',
);

// Assertion 4: Mutational fuzzer executes 10,000 adversarial inputs with zero fatal crashes
assert(
  fuzzAnomaliesFatal === 0 && totalFuzzRuns === 10000,
  'Assertion 4: Fuzz runner survives 10,000 adversarial mutations with 0 crashes',
);

// Assertion 5: Final cryptographic certification hash generated and verified
assert(
  campaignCertified && certificationHash.length === 64,
  'Assertion 5: MIRRORGRID final performance and reliability certification achieved',
);
```

---

## 13. Pitfalls

1. **Testing memory leaks before JIT compilation stabilizes:** V8 allocates memory during initial JIT
   optimization (Turbofan). Always execute a warmup phase of 5,000 requests before taking the baseline snapshot.
2. **File descriptor exhaustion under 10k RPS:** Running high throughput without connection reuse exhausts
   ephemeral ports (`EADDRNOTAVAIL` / `EMFILE`). Keep-alive connection pooling is mandatory.
3. **GC pauses misdiagnosed as network latency:** Heavy allocation can trigger full Mark-Sweep GCs.
   Keep hot-path allocations to near-zero (object reuse and primitive types).
4. **Client-side CPU bottlenecks:** If the load generator maxes out 100% CPU on the test machine,
   observed latency measurements will reflect client queueing rather than server performance.

---

## 14. Done

- [ ] `packages/campaign` compiles under strict TypeScript with 0 errors.
- [ ] Load generator achieves 10,000+ req/s sustained throughput.
- [ ] V8 heap differential analyzer certifies zero memory leaks.
- [ ] Mutational fuzzer passes 10,000 adversarial inputs with zero unhandled crashes.
- [ ] Migration `014_campaign.sql` applied cleanly in Postgres.
- [ ] Chaos Campaign Command Center and Final Certification Badge live in web UI.
- [ ] `npm run verify:campaign` runs green in CI with all 5 gate assertions passing.
- [ ] MIRRORGRID full platform certified complete and interview-ready.
