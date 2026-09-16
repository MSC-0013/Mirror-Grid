# M05 — Experiment Engine and Flagship Demo

## 1. Context

This milestone is the culmination of Tier 1 and marks the **v0.1 Release** of MIRRORGRID.

Up to this point, MIRRORGRID has built the foundational pieces:

- The domain model and topology graph (M01).
- The deterministic logical simulator with virtual clock and state hashes (M02).
- The container runtime peer running real Docker containers (M03).
- The formal reliability state machines and fault engine (M04).

The **Experiment Engine** synthesizes these into a cohesive scientific instrument. In MIRRORGRID, an
experiment is not a random bash script that kills containers; it is a structured scientific hypothesis:

> _"If Payments latency degrades to 400ms, does the Orders circuit breaker trip before Orders thread pool
> saturates, or does retry amplification propagate a cascading collapse back to the API Gateway?"_

An experiment manages the entire experimental lifecycle: measuring baseline performance, executing
scheduled fault injections, evaluating automated anomaly detectors (recording exact MTTD and MTTR),
and producing an immutable experiment report.

Furthermore, this milestone establishes the **Flagship Scenario** — the canonical demonstration of
cascading failure, retry amplification, and circuit breaker limit cycles that serves as the centerpiece
of the portfolio artifact.

---

## 2. Prerequisites

- M00 green (`verify:m0` — walking skeleton)
- M01 green (`verify:m1` — domain topology)
- M02 green (`verify:determinism` — logical engine and state hash)
- M04 green (`verify:m4` — reliability primitives)
- M03 green (`verify:m3` — container runtime)
- Docker Compose profile: `--profile core` (Fast CI verification) or `--profile full` (Container demonstration)

---

## 3. Scope

### In scope

- Experiment lifecycle state machine (`DRAFT -> SCHEDULED -> RUNNING_BASELINE -> FAULT_INJECTED -> RECOVERING -> COMPLETED / ABORTED`).
- Frozen Experiment Configuration: Deep immutable snapshot of topology, workload, faults, and detector rules.
- Automated Anomaly Detectors: Sliding window rules measuring exact **MTTD** (Mean Time to Detect)
  and **MTTR** (Mean Time to Recover).
- Live Experiment Hero Screen (`apps/web/src/app/worlds/[worldId]/experiments/[id]/page.tsx`):
  Synchronized topology status heatmap, live metrics time-series, incident event timeline, and MTTD/MTTR telemetry.
- Flagship Scenario Definition: 4-tier microservice architecture (Gateway -> Orders -> Payments -> Database)
  demonstrating cascading failure vs resilience.
- Database migration `006_experiments.sql`: Experiments, runs, detectors, and event logs.
- Gate script `npm run verify:flagship`: The v0.1 release certification suite.

### Explicitly out of scope

- Distributed async job queue and worker leases (M07 — in M05, experiment runs execute via in-memory orchestrator).
- Kafka-based CQRS event publishing (M08).
- Multi-run statistical regression analysis (M10).
- Automatic PDF / Markdown executive report export (M10).

---

## 4. Design

### The Experiment Lifecycle

An experiment transitions through a strict, auditable state machine with optimistic concurrency control:

```
               +-------------------------------------------------------+
               |                                                       |
               v                                                       |
+-------+   start()   +------------------+   warmup elapsed  +-------------------+
| DRAFT | ----------> | RUNNING_BASELINE | ----------------> |  FAULT_INJECTED   |
+-------+             +------------------+                   +-------------------+
    |                          |                                       |
    | cancel()                 | abort()                               | fault duration
    v                          v                                       v
+-------+             +------------------+                   +-------------------+
|ARCHIVED|            |     ABORTED      | <---------------- |    RECOVERING     |
+-------+             +------------------+      abort()      +-------------------+
                                                                       |
                                                             cooldown  | elapsed
                                                                       v
                                                             +-------------------+
                                                             |     COMPLETED     |
                                                             +-------------------+
```

1. **DRAFT:** Experiment is being defined in the UI or via API. Topology, faults, and detectors are editable.
2. **RUNNING_BASELINE:** The engine runs the workload under normal conditions (e.g. 30 seconds) to establish
   healthy baseline latency (P50/P99) and zero error rate.
3. **FAULT_INJECTED:** The scheduled faults activate. Detectors monitor the world to record the exact microsecond
   of anomaly detection (MTTD).
4. **RECOVERING:** Faults are disarmed. The system monitors how quickly queues drain and metrics return to
   baseline thresholds (MTTR).
5. **COMPLETED:** Final metrics aggregated, canonical state hash computed, and run frozen permanently.

### The Frozen Configuration Pattern

When an experiment starts, its complete specification is serialized into `frozen_config` JSONB:

- Full topology graph (services, edges, capacities).
- Workload profile (RPS curve, payload distributions).
- Fault specifications and schedules.
- Detector thresholds and hysteresis rules.
- PRNG root seed and engine version.

Even if an operator later edits the World topology, the historical Experiment Run remains 100% reproducible
because it executes solely from `frozen_config`.

### MTTD and MTTR Definitions

MIRRORGRID treats reliability metrics with mathematical precision:

- **MTTD (Mean Time to Detect):**
  $$\text{MTTD} = T_{\text{first\_detector\_trigger}} - T_{\text{fault\_injected}}$$
  Measured in integer microseconds. If a fault is injected at $T = 15.000\text{s}$ and the error rate detector
  trips at $T = 16.240\text{s}$, $\text{MTTD} = 1,240,000\mu\text{s}$ ($1.24\text{s}$).
- **MTTR (Mean Time to Recover):**
  $$\text{MTTR} = T_{\text{all\_detectors\_cleared}} - T_{\text{fault\_disarmed}}$$
  The time required for service queues to drain, circuit breakers to transition through `HALF_OPEN` back
  to `CLOSED`, and latency percentiles to return within $1.1\times$ of baseline.

### The Flagship Scenario: "The Cascading Collapse"

The flagship scenario is MIRRORGRID’s headline demonstration:

```
[ Workload Generator (200 RPS) ]
               |
               v
     +-------------------+
     |    API Gateway    |
     +-------------------+
               |
               v
     +-------------------+
     |   Orders Service  | (Holds concurrency slot while waiting)
     +-------------------+
               |
               v
     +-------------------+
     | Payments Service  | <--- [ FAULT: +400ms Latency injected at T=15s ]
     +-------------------+
               |
               v
     +-------------------+
     | Database Cluster  |
     +-------------------+
```

#### Run A: Without Resilience Primitives (The Collapse)

1. At $T=15\text{s}$, Payments latency jumps from 20ms to 420ms.
2. Orders concurrency pool (64 slots) fills up in 150ms ($64 / 0.42\text{s} = 152\text{ req/s}$ capacity vs 200 offered).
3. Orders queue saturates; Orders begins dropping requests with 504.
4. Gateway retries every failed Orders call 3 times without a retry budget.
5. Traffic spikes from 200 RPS to 600 RPS (Retry Amplification Factor: $3.0\times$).
6. Gateway thread pool exhausts; entire system collapses into complete outage.

#### Run B: With MIRRORGRID Resilience Primitives (The Shield)

1. At $T=15\text{s}$, Payments latency jumps to 420ms.
2. Orders Circuit Breaker records failure rate > 50% and trips to `OPEN` at $T=17.2\text{s}$ ($\text{MTTD} = 2.2\text{s}$).
3. Subsequent Orders -> Payments calls fast-fail in $0.1\text{ms}$ with degraded fallback response.
4. Orders concurrency drops back to 5 slots; Orders queue remains empty.
5. Gateway Retry Budget caps retries to 10%, preventing traffic multiplication.
6. Payments fault clears at $T=35\text{s}$. Orders breaker enters `HALF_OPEN` at $T=40\text{s}$, tests 2 trial
   requests, verifies health, and re-closes at $T=42.5\text{s}$ ($\text{MTTR} = 7.5\text{s}$).
7. Gateway P99 latency never exceeds 100ms.

---

## 5. Data Model

Full DDL for migration `packages/db/src/migrations/006_experiments.sql`:

```sql
-- 006_experiments.sql: Experiments, runs, detectors, and execution event logs

-- 1. Experiments definition table
CREATE TABLE experiments (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    world_id UUID NOT NULL REFERENCES worlds(id) ON DELETE CASCADE,
    name VARCHAR(120) NOT NULL,
    hypothesis TEXT NOT NULL,
    status VARCHAR(30) NOT NULL DEFAULT 'DRAFT', -- DRAFT, SCHEDULED, RUNNING, COMPLETED, ABORTED, ARCHIVED
    version INTEGER NOT NULL DEFAULT 1,
    baseline_duration_micros BIGINT NOT NULL DEFAULT 30000000, -- 30s
    fault_duration_micros BIGINT NOT NULL DEFAULT 30000000,    -- 30s
    cooldown_duration_micros BIGINT NOT NULL DEFAULT 15000000, -- 15s
    frozen_config JSONB,                                      -- Populated when moved to SCHEDULED/RUNNING
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_experiments_world ON experiments(world_id, status);

-- 2. Experiment execution runs (each execution of an experiment)
CREATE TABLE experiment_runs (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    experiment_id UUID NOT NULL REFERENCES experiments(id) ON DELETE CASCADE,
    run_number INTEGER NOT NULL DEFAULT 1,
    runtime_mode VARCHAR(20) NOT NULL, -- LOGICAL, CONTAINER, HYBRID
    seed VARCHAR(64) NOT NULL,
    state_hash VARCHAR(64),
    current_phase VARCHAR(30) NOT NULL DEFAULT 'WARMUP', -- WARMUP, FAULT, RECOVERY, TEARDOWN
    mttd_micros BIGINT,
    mttr_micros BIGINT,
    peak_error_rate_ppm INTEGER DEFAULT 0,
    peak_p99_micros BIGINT DEFAULT 0,
    started_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    completed_at TIMESTAMPTZ,
    result_summary JSONB DEFAULT '{}'::jsonb,
    CONSTRAINT uq_exp_run_number UNIQUE (experiment_id, run_number)
);

CREATE INDEX idx_exp_runs_experiment ON experiment_runs(experiment_id);

-- 3. Anomaly detectors configured for an experiment
CREATE TABLE experiment_detectors (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    experiment_id UUID NOT NULL REFERENCES experiments(id) ON DELETE CASCADE,
    name VARCHAR(120) NOT NULL,
    detector_type VARCHAR(50) NOT NULL, -- ERROR_RATE, P99_LATENCY, CIRCUIT_TRIPPED, QUEUE_SATURATION
    target_service_id UUID REFERENCES services(id) ON DELETE CASCADE,
    target_edge_id UUID REFERENCES service_edges(id) ON DELETE CASCADE,
    threshold_value NUMERIC(12, 4) NOT NULL,
    window_duration_micros BIGINT NOT NULL DEFAULT 5000000, -- 5s sliding window
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_detectors_experiment ON experiment_detectors(experiment_id);

-- 4. Immutable timeline events generated during a run
CREATE TABLE experiment_events (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    run_id UUID NOT NULL REFERENCES experiment_runs(id) ON DELETE CASCADE,
    sim_time_micros BIGINT NOT NULL,
    event_category VARCHAR(50) NOT NULL, -- PHASE_CHANGE, FAULT_INJECTED, FAULT_CLEARED, DETECTOR_TRIGGERED, DETECTOR_RESOLVED, BREAKER_STATE
    summary VARCHAR(255) NOT NULL,
    details JSONB DEFAULT '{}'::jsonb,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_exp_events_timeline ON experiment_events(run_id, sim_time_micros ASC);
```

### Index rationale

- `idx_experiments_world`: Powers the experiment catalog view for a world.
- `uq_exp_run_number`: Enforces sequential execution numbering per experiment.
- `idx_exp_events_timeline`: Enables smooth playback and incident log reconstruction in chronological order.

---

## 6. Packages

```
packages/experiments/
├── package.json
├── tsconfig.json
├── src/
│   ├── index.ts                     # Public package exports
│   ├── engine/
│   │   ├── orchestrator.ts          # State machine coordinating phases and runtimes
│   │   ├── freeze.ts                # Deep snapshot generator for frozen_config
│   │   └── timeline.ts              # Experiment event logger and serializer
│   ├── detectors/
│   │   ├── detector-engine.ts       # Sliding window metric evaluator
│   │   ├── detector-rules.ts        # Error rate, latency, and breaker detector types
│   │   └── mttd-calculator.ts       # MTTD and MTTR mathematical derivation
│   └── scenarios/
│       ├── flagship.ts              # Canonical Cascading Collapse scenario builder
│       └── catalog.ts               # Pre-configured templates (Thundering Herd, Slow Consumer)
packages/db/
├── src/
│   ├── schema/
│   │   └── experiments.ts           # Drizzle schema matching 006_experiments.sql
│   └── migrations/
│       └── 006_experiments.sql      # Migration DDL above
apps/control/
├── src/
│   └── modules/
│       └── experiments/
│           ├── experiment.routes.ts # Routes under /api/v1/worlds/:worldId/experiments
│           ├── experiment.controller.ts
│           ├── experiment.service.ts# Execution lifecycle coordinator
│           ├── experiment.repository.ts
│           └── experiment.schema.ts # zod schemas
apps/web/
├── src/
│   └── app/
│       └── worlds/
│           └── [worldId]/
│               └── experiments/
│                   ├── page.tsx     # Experiment catalog list view
│                   ├── new/
│                   │   └── page.tsx # Experiment Wizard designer
│                   └── [experimentId]/
│                       └── page.tsx # Live Experiment Hero Screen (§61, §62)
```

---

## 7. Interfaces

### Experiment Configuration and Frozen Spec

```typescript
// packages/experiments/src/engine/freeze.ts
import type { TopologyExport } from '@mirrorgrid/topology';
import type { FaultSpec } from '@mirrorgrid/reliability';

export interface DetectorSpec {
  readonly id: string;
  readonly name: string;
  readonly type: 'ERROR_RATE' | 'P99_LATENCY' | 'CIRCUIT_TRIPPED' | 'QUEUE_SATURATION';
  readonly targetId: string;
  readonly threshold: number;
  readonly windowMicros: bigint;
}

export interface FrozenExperimentConfig {
  readonly experimentId: string;
  readonly worldId: string;
  readonly version: number;
  readonly seed: string;
  readonly engineVersion: string;
  readonly topology: TopologyExport;
  readonly faults: readonly FaultSpec[];
  readonly detectors: readonly DetectorSpec[];
  readonly schedule: {
    readonly baselineMicros: bigint;
    readonly faultMicros: bigint;
    readonly cooldownMicros: bigint;
  };
}
```

### Anomaly Detector Engine Contract

```typescript
// packages/experiments/src/detectors/detector-engine.ts

export interface AnomalyEvaluation {
  readonly detectorId: string;
  readonly isTriggered: boolean;
  readonly currentValue: number;
  readonly threshold: number;
  readonly atMicros: bigint;
}

export interface DetectorResult {
  readonly mttdMicros: bigint | null;
  readonly mttrMicros: bigint | null;
  readonly firstTriggeredAtMicros: bigint | null;
  readonly allResolvedAtMicros: bigint | null;
  readonly incidentDurationMicros: bigint | null;
}

export interface DetectorEngine {
  registerDetector(spec: DetectorSpec): void;
  evaluateMetrics(nowMicros: bigint, metrics: MetricSample): readonly AnomalyEvaluation[];
  onFaultInjected(faultId: string, atMicros: bigint): void;
  onFaultCleared(faultId: string, atMicros: bigint): void;
  computeResults(): DetectorResult;
}
```

---

## 8. API

Routes in `apps/control` under `/api/v1/worlds/:worldId/experiments`.

### 1. Create Experiment

- `POST /api/v1/worlds/:worldId/experiments`
- **Request Body (zod schema):**
  ```typescript
  export const createExperimentSchema = z.object({
    name: z.string().min(1).max(120),
    hypothesis: z.string().min(1),
    baselineDurationMicros: z.number().int().positive().default(30_000_000),
    faultDurationMicros: z.number().int().positive().default(30_000_000),
    cooldownDurationMicros: z.number().int().positive().default(15_000_000),
    faultSpecIds: z.array(z.string().uuid()).min(1),
    detectors: z.array(
      z.object({
        name: z.string(),
        detectorType: z.enum(['ERROR_RATE', 'P99_LATENCY', 'CIRCUIT_TRIPPED', 'QUEUE_SATURATION']),
        targetServiceId: z.string().uuid().optional(),
        targetEdgeId: z.string().uuid().optional(),
        thresholdValue: z.number(),
        windowDurationMicros: z.number().int().positive().default(5_000_000),
      }),
    ),
  });
  ```
- **Response:** `201 Created` with created experiment details.

### 2. Launch Experiment Run

- `POST /api/v1/worlds/:worldId/experiments/:experimentId/start`
- **Request Body:** `{ runtimeMode: 'LOGICAL' | 'CONTAINER' | 'HYBRID', seed?: string }`
- **Response:** `202 Accepted` with `{ runId: string, status: 'WARMUP', runNumber: number }`.

### 3. Get Experiment Live Status

- `GET /api/v1/worlds/:worldId/experiments/:experimentId/status`
- **Response:** `200 OK` with phase, current sim time, active faults, and detector statuses.

### 4. Abort Experiment Run

- `POST /api/v1/worlds/:worldId/experiments/:experimentId/abort`
- **Request Body:** `{ reason: string }`
- **Response:** `200 OK` with `{ status: 'ABORTED', abortedAtMicros: string }`.

### 5. Get Comprehensive Report

- `GET /api/v1/worlds/:worldId/experiments/:experimentId/runs/:runNumber/report`
- **Response:** `200 OK` with complete telemetry, state hash, MTTD/MTTR results, and timeline events.

---

## 9. UI

### 1. Live Experiment Hero Screen (`apps/web/src/app/worlds/[worldId]/experiments/[id]/page.tsx`)

- **Spec alignment:** §61 (Live Experiment Monitor), §62 (Incident Replay & Diagnostics).
- **Layout:**
  - **Top Navigation & HUD:**
    - Experiment title, Hypothesis callout banner.
    - Run badge (`Run #1 — LOGICAL`, Seed: `8f21a4bc...`).
    - Phase Progress Bar: `[ 1. Baseline 30s | 2. Fault Active 30s | 3. Cooldown 15s ]` with moving cursor.
    - Prominent Emergency Abort button.
  - **Main Dashboard (Split View):**
    - **Left Pane (Topology Heatmap Overlay):** Real-time React Flow canvas from M01 showing service nodes colored
      by status (Green healthy, Amber degraded, Red failing, Grey circuit open). Edge lines show animated particle flow
      with traffic volume and drop indicators.
    - **Right Pane (Telemetry Graphs):** Synchronized 3-chart stack:
      1. Offered vs Completed RPS (visualizing load vs capacity).
      2. P50, P95, P99 Latency curves (highlighting degradation threshold).
      3. Active Concurrency & Queue Depth per service.
  - **Bottom Panel (Incident Event Log & Reliability Scorecard):**
    - Chronological log of transitions: `T+15.0s: Fault LATENCY (+400ms) injected on Payments`.
    - `T+17.2s: Detector ERROR_RATE_ORDERS triggered (value: 62% > 50%) -> MTTD: 2.20s`.
    - `T+17.3s: Orders -> Payments Circuit Breaker tripped to OPEN`.
    - Scorecard Cards: `MTTD: 2.20s`, `MTTR: 7.50s`, `Retry Amplification: 1.08x (Capped)`, `Canonical State Hash: 0x9e4b...`.

---

## 10. Steps

1. **Create `packages/experiments` package:** Setup structure, build configuration, and types.
2. **Implement `frozen_config` serializer:** Deep serialization of world topology, faults, and detectors.
3. **Build Anomaly Detector Engine:** Implement sliding window evaluators and MTTD/MTTR calculation logic.
4. **Build Experiment State Machine Orchestrator:** Implement baseline, fault, recovery, and completion phase transitions.
5. **Implement Flagship Scenario Builder:** Pre-configure the 4-tier Cascading Collapse scenario in `packages/experiments/src/scenarios/flagship.ts`.
6. **Database migration `006_experiments.sql`:** Create tables for experiments, runs, detectors, and events.
7. **Build Control Plane endpoints:** Add routes in `apps/control/src/modules/experiments/` for lifecycle management.
8. **Implement Live Experiment Hero Screen:** Build Next.js page in `apps/web` with topology overlay and live charts.
9. **Build Experiment Creation Wizard:** Build `apps/web/src/app/worlds/[worldId]/experiments/new/page.tsx`.
10. **Connect Container Runtime to Experiment Orchestrator:** Verify experiment runs execute cleanly under both logical and container adapters.
11. **Implement `npm run verify:flagship` gate script:** Automated release verification suite asserting all 5 criteria.
12. **Prepare v0.1 Release Artifacts:** Tag git repository `v0.1` and verify full system documentation.

---

## 11. Testing

### Unit tests (`packages/experiments/tests/unit`)

- `detector-engine.test.ts`: Test sliding window evaluator triggers within tolerance and calculates exact microsecond MTTD.
- `freeze.test.ts`: Assert `frozen_config` snapshot is byte-for-byte deterministic across repeated runs.
- `state-machine.test.ts`: Assert invalid state transitions (e.g. COMPLETED -> FAULT) throw `AppError.conflict()`.

### Integration tests (`apps/control/tests/integration/experiments`)

- Test full experiment execution lifecycle via REST API.
- Test that aborting an experiment immediately cancels active faults and records the abort event in Postgres.

### E2E Flagship Verification (`tests/e2e/flagship.test.ts`)

- Execute Flagship Scenario Run A (Unprotected): Assert Gateway thread exhaustion and cascading collapse.
- Execute Flagship Scenario Run B (Protected): Assert circuit breaker trips, retry budget caps traffic, and Gateway survives.

---

## 12. Gate

Command: `npm run verify:flagship`

This script executes the complete Flagship Scenario in fast simulation mode and certifies the MIRRORGRID v0.1 release:

```typescript
// tests/gates/verify-flagship.ts

// Assertion 1: Unprotected run exhibits catastrophic retry amplification (> 2.5x traffic)
assert(
  unprotectedAmplification >= 2.5,
  'Assertion 1: Retry amplification observed in unprotected graph',
);

// Assertion 2: Protected run trips circuit breaker to OPEN within 3 seconds of fault injection
assert(
  breakerTripped && mttdSeconds <= 3.0,
  'Assertion 2: Circuit breaker trips rapidly (MTTD <= 3s)',
);

// Assertion 3: Retry budget caps retry amplification under 1.15x during active failure
assert(protectedAmplification <= 1.15, 'Assertion 3: Retry budget strictly prevents traffic storm');

// Assertion 4: System cleanly recovers after fault removal with verifiable MTTR
assert(
  systemRecovered && mttrSeconds <= 10.0,
  'Assertion 4: System recovers to baseline (MTTR <= 10s)',
);

// Assertion 5: Repeated run with identical seed reproduces exact canonical state hash
assert(
  run1.stateHash === run2.stateHash,
  'Assertion 5: Bit-for-bit reproducible state hash across runs',
);
```

---

## 13. Pitfalls

1. **Mutating experiment parameters during execution:** Once an experiment enters `RUNNING_BASELINE`,
   all parameters must be read exclusively from `frozen_config`. Any attempt to patch world topology
   must not affect the active run.
2. **Detector false positives during warmup:** The baseline phase must run long enough for initial
   caches and connection pools to stabilize before anomaly detectors arm.
3. **Flapping detectors without hysteresis:** An error rate hovering around 50% can trigger and resolve
   a detector multiple times per second, corrupting MTTR calculations. Require a debounce duration
   (e.g. healthy for 3 consecutive seconds) before marking a detector resolved.
4. **Failing to clean up on abort:** If the user clicks Emergency Abort, the orchestrator must guarantee
   that all injected faults in the underlying runtime (simulated or container) are disarmed immediately.

---

## 14. Done

- [ ] `packages/experiments` compiles under strict TypeScript with 0 errors.
- [ ] Anomaly detector engine calculates microsecond-exact MTTD and MTTR.
- [ ] Flagship scenario definition produces measurable cascading failure without protection, and clean mitigation with protection.
- [ ] Migration `006_experiments.sql` applied cleanly in Postgres.
- [ ] Live Experiment Hero Screen displays synchronized topology status, metrics charts, and incident timeline.
- [ ] `npm run verify:flagship` runs green in CI with all 5 gate assertions passing.
- [ ] Git repository tagged `v0.1` representing the complete, shippable Tier 1 core.
