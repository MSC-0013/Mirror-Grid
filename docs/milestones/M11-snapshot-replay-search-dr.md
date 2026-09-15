# M11 — Snapshot, Replay, Search, and Disaster Recovery

## 1. Context

Distributed systems failures are notoriously difficult to reproduce. A race condition or cascading
collapse that occurs at $T=47.2\text{s}$ under high load often disappears when engineers try to reproduce
it manually. In conventional environments, post-mortems rely on incomplete logs and guesswork.

MIRRORGRID’s architecture makes something far more powerful possible: **deterministic rewind, state inspection,
and checkpoint bisection**. Because the logical engine (M02) is mathematically deterministic and events
are strictly ordered (M08), we can capture incremental Merkle checkpoints of an entire world and rewind
time to the exact microsecond before a catastrophe occurred.

Furthermore, production-grade resilience demands rigorous **Disaster Recovery (DR)**. Systems must
measure, not guess, their Recovery Point Objective (RPO) and Recovery Time Objective (RTO).

This milestone delivers the **Incident Time Machine and DR Platform**:
1. **Incremental Merkle Checkpointing:** Content-addressable state snapshots capturing complete service,
   queue, breaker, and in-flight message state.
2. **Deterministic Replay Engine:** Rewind an experiment to any prior checkpoint, re-execute recorded workloads,
   and verify bit-for-bit state hash identity.
3. **Checkpoint Bisection:** Binary-search across execution checkpoints to isolate the exact microsecond
   where two runs diverged.
4. **Disaster Recovery Drills:** Automated recovery simulation that drops live world state, restores from
   snapshots, and calculates exact mathematical RPO and RTO.

---

## 2. Prerequisites

- M02 green (`verify:determinism` — virtual clock & Merkle state hash)
- M05 green (`verify:flagship` — experiment engine)
- M08 green (`verify:events` — event sourcing & outbox)
- Docker Compose profile: `--profile core` (Postgres and Redis)

---

## 3. Scope

### In scope
- `packages/recovery`: Merkle snapshot serializer, content-addressable component storage, deterministic
  replay coordinator, bisection algorithm, and DR restoration manager.
- Checkpoint capture: Periodic (every $N$ virtual seconds) and trigger-based (on fault injection or breaker trip).
- Checkpoint Bisection tool: Automated binary search locating the first divergent event between two runs.
- Full-Text Incident Search: PostgreSQL full-text search across past incident reports, audit logs, and detector events.
- Disaster Recovery Simulation: Dropping world state, restoring from archive, and verifying operational integrity.
- Database migration `012_recovery.sql`: `world_snapshots`, `snapshot_components`, `dr_restorations`.
- UI: Incident Time Machine & Replay Console (§75), Checkpoint Explorer, and DR Scorecard.

### Explicitly out of scope
- Multi-region cross-cloud block storage replication (e.g. AWS S3 cross-region replication).
- Physical PostgreSQL WAL shipping / hot standby streaming replication.
- Unstructured image or video artifact archival.

---

## 4. Design

### Incremental Merkle Checkpoints

Dumping the entire database every second would consume gigabytes of storage. MIRRORGRID utilizes
**content-addressable component checkpointing**:

```
+-------------------------------------------------------------------------+
|                        World Checkpoint (Merkle Root)                   |
|                        root_hash: SHA256(Sorted Components)             |
+-------------------------------------------------------------------------+
       |                         |                         |
       v                         v                         v
+--------------+          +--------------+          +--------------+
| Service A    |          | Service B    |          | Breaker AB   |
| hash: 0xa1b2 |          | hash: 0xc3d4 |          | hash: 0xe5f6 |
+--------------+          +--------------+          +--------------+
```

1. Each component (a service queue, a circuit breaker state machine, an active fault set) serializes
   its state to deterministic binary/JSON and computes `SHA256(payload)`.
2. If the component's hash matches the previous checkpoint, **no new payload is stored**; only a foreign
   key pointer is recorded.
3. The Merkle Root Hash is the SHA-256 hash of all sorted `(componentId, componentHash)` pairs.
4. This yields $> 90\%$ storage deduplication across successive checkpoints during an experiment run.

### The Time Machine Replay Protocol

To replay an incident:
1. The operator selects an experiment run and scrubs the timeline to time $T_0$.
2. The Replay Engine identifies the nearest preceding checkpoint $C \le T_0$.
3. The world is initialized with the exact state from $C$.
4. Recorded input events (workload requests, fault activations) between $C$ and $T_0$ are re-fed into
   the engine via the `FastDriver`.
5. The canonical state hash is computed at $T_0$. If it matches the historical run's hash at $T_0$,
   replay fidelity is certified.
6. The operator can now switch to `RealtimeDriver` at $1\times$ speed, alter a circuit breaker parameter,
   and observe whether the cascade is prevented (counterfactual branching).

### Checkpoint Bisection Algorithm

When refactoring a reliability algorithm or upgrading the engine version, two runs with identical seeds
might diverge. Finding where they parted manually across millions of events is needle-in-a-haystack work.

The **Bisector** runs a binary search across checkpoints:
$$\text{midpoint} = \lfloor(\text{low} + \text{high}) / 2\rfloor$$
- Restore checkpoint at `midpoint`.
- Replay to `midpoint + 1` tick.
- Compare Merkle root hash against baseline run.
- If match: divergence is in the second half (`low = midpoint + 1`).
- If mismatch: divergence is in the first half (`high = midpoint`).
- At termination (window size = 1 event), the bisector compares component hashes to name the exact
  offending entity:
  > *"Divergence detected at T=18,241,000µs on Service [orders]: queueDepth was 12 in Run 1 but 13 in Run 2."*

### Disaster Recovery: Measuring RPO and RTO

MIRRORGRID treats DR as a verifiable test suite, not a compliance checklist:
- **RPO (Recovery Point Objective):** The maximum data loss window. Measured as:
  $$\text{RPO} = T_{\text{disaster}} - T_{\text{latest\_snapshot}}$$
- **RTO (Recovery Time Objective):** The real-world elapsed time required to restore service availability:
  $$\text{RTO} = T_{\text{health\_verified}} - T_{\text{restore\_initiated}}$$
The DR verification gate (`verify:recovery`) simulates a catastrophic drop and asserts $\text{RTO} < 5\text{s}$
and zero data corruption.

---

## 5. Data Model

Full DDL for migration `packages/db/src/migrations/012_recovery.sql`:

```sql
-- 012_recovery.sql: World checkpoints, incremental components, and DR drills

-- 1. World Checkpoints table (Merkle roots)
CREATE TABLE world_snapshots (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    world_id UUID NOT NULL REFERENCES worlds(id) ON DELETE CASCADE,
    experiment_run_id UUID REFERENCES experiment_runs(id) ON DELETE CASCADE,
    sim_time_micros BIGINT NOT NULL,
    sequence_num BIGINT NOT NULL,
    merkle_root_hash VARCHAR(64) NOT NULL,
    snapshot_type VARCHAR(30) NOT NULL DEFAULT 'PERIODIC', -- PERIODIC, TRIGGERED, MANUAL, PRE_FAULT
    trigger_reason VARCHAR(120),
    total_components INTEGER NOT NULL,
    deduplicated_components INTEGER NOT NULL,
    size_bytes BIGINT NOT NULL DEFAULT 0,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_snapshots_world_time ON world_snapshots(world_id, sim_time_micros ASC);
CREATE INDEX idx_snapshots_run ON world_snapshots(experiment_run_id, sequence_num ASC);

-- 2. Content-Addressable Component Snapshots
CREATE TABLE snapshot_components (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    snapshot_id UUID NOT NULL REFERENCES world_snapshots(id) ON DELETE CASCADE,
    component_type VARCHAR(50) NOT NULL, -- 'SERVICE_STATE', 'CIRCUIT_BREAKER', 'QUEUE_STATE', 'FAULT_STATE'
    component_id VARCHAR(120) NOT NULL,
    component_hash VARCHAR(64) NOT NULL,
    state_payload JSONB NOT NULL,
    is_deduplicated BOOLEAN NOT NULL DEFAULT FALSE,
    CONSTRAINT uq_snapshot_component UNIQUE (snapshot_id, component_type, component_id)
);

CREATE INDEX idx_components_lookup ON snapshot_components(component_hash);

-- 3. Disaster Recovery (DR) Drills and Restorations
CREATE TABLE dr_restorations (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    world_id UUID NOT NULL REFERENCES worlds(id) ON DELETE CASCADE,
    snapshot_id UUID NOT NULL REFERENCES world_snapshots(id) ON DELETE CASCADE,
    restore_status VARCHAR(30) NOT NULL DEFAULT 'IN_PROGRESS', -- IN_PROGRESS, COMPLETED, FAILED
    rpo_micros BIGINT NOT NULL,
    rto_ms INTEGER NOT NULL,
    verification_hash_match BOOLEAN NOT NULL DEFAULT FALSE,
    error_message TEXT,
    restored_by VARCHAR(120) NOT NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    completed_at TIMESTAMPTZ
);

CREATE INDEX idx_dr_world ON dr_restorations(world_id, created_at DESC);
```

### Index rationale
- `idx_snapshots_world_time`: Powers the interactive scrubber in the Incident Time Machine.
- `idx_components_lookup`: Enables deduplication checks when storing component payloads.

---

## 6. Packages

```
packages/recovery/
├── package.json
├── tsconfig.json
├── src/
│   ├── index.ts                     # Public API exports
│   ├── snapshot/
│   │   ├── snapshot-service.ts      # Merkle checkpoint generator
│   │   ├── dedup-storage.ts         # Content-addressable payload store
│   │   └── serializer.ts            # Canonical length-prefixed state packer
│   ├── replay/
│   │   ├── replay-engine.ts         # Fast-forward and realtime replay coordinator
│   │   ├── branch-controller.ts     # Counterfactual scenario forking
│   │   └── bisector.ts              # Checkpoint binary search bisection tool
│   ├── dr/
│   │   ├── dr-coordinator.ts        # Automated DR drill simulator
│   │   └── rpo-rto-calculator.ts    # Mathematical RPO and RTO auditor
│   └── search/
│       ├── incident-search.ts       # PostgreSQL full-text incident query engine
│       └── query-builder.ts
packages/db/
├── src/
│   ├── schema/
│   │   └── recovery.ts              # Drizzle schema matching 012_recovery.sql
│   └── migrations/
│       └── 012_recovery.sql         # Migration DDL above
apps/control/
├── src/
│   └── modules/
│       └── recovery/
│           ├── recovery.routes.ts   # Checkpoint, replay, bisect, and DR routes
│           ├── recovery.controller.ts
│           └── recovery.service.ts
apps/web/
├── src/
│   └── app/
│       └── worlds/
│           └── [worldId]/
│               ├── replay/
│               │   └── page.tsx     # Incident Time Machine & Replay Console (§75)
│               ├── search/
│               │   └── page.tsx     # Full-Text Incident Search Explorer
│               └── dr/
│                   └── page.tsx     # DR Drill & RPO/RTO Scorecard
```

---

## 7. Interfaces

### Checkpoint and Replay Contracts

```typescript
// packages/recovery/src/snapshot/snapshot-service.ts

export interface ComponentSnapshot {
  readonly componentType: string;
  readonly componentId: string;
  readonly componentHash: string;
  readonly payload: Record<string, unknown>;
}

export interface MerkleSnapshot {
  readonly id: string;
  readonly worldId: string;
  readonly simTimeMicros: bigint;
  readonly sequenceNum: bigint;
  readonly merkleRootHash: string;
  readonly components: readonly ComponentSnapshot[];
}

export interface BisectionDifference {
  readonly simTimeMicros: bigint;
  readonly componentType: string;
  readonly componentId: string;
  readonly run1Hash: string;
  readonly run2Hash: string;
  readonly run1Payload: unknown;
  readonly run2Payload: unknown;
}

export interface Bisector {
  findDivergence(run1Id: string, run2Id: string): Promise<BisectionDifference | null>;
}
```

### Disaster Recovery Simulator Contract

```typescript
// packages/recovery/src/dr/dr-coordinator.ts

export interface DrDrillResult {
  readonly restorationId: string;
  readonly snapshotId: string;
  readonly rpoMicros: bigint;
  readonly rtoMs: number;
  readonly hashVerified: boolean;
  readonly restoredComponentsCount: number;
}

export interface DrCoordinator {
  executeDrill(worldId: string, snapshotId: string): Promise<DrDrillResult>;
}
```

---

## 8. API

Routes in `apps/control` under `/api/v1/worlds/:worldId/recovery`.

### 1. Capture World Checkpoint
- `POST /api/v1/worlds/:worldId/recovery/snapshots`
- **Request Body:** `{ reason?: string }`
- **Response:** `201 Created` with `MerkleSnapshot` summary and Merkle root hash.

### 2. Rewind & Replay Incident
- `POST /api/v1/worlds/:worldId/recovery/replay`
- **Request Body (zod schema):**
  ```typescript
  export const replayRequestSchema = z.object({
    experimentRunId: z.string().uuid(),
    targetSimTimeMicros: z.number().int().nonnegative(),
    playbackRate: z.enum(['FAST', '1X', '2X', '0.5X']).default('FAST'),
  });
  ```
- **Response:** `200 OK` with `{ status: 'REPLAY_READY', simTimeMicros: string, stateHash: string }`.

### 3. Bisect Divergence
- `POST /api/v1/worlds/:worldId/recovery/bisect`
- **Request Body:** `{ run1Id: string, run2Id: string }`
- **Response:** `200 OK` with `BisectionDifference` detailing the exact diverging component.

### 4. Run Disaster Recovery Drill
- `POST /api/v1/worlds/:worldId/recovery/dr/drill`
- **Request Body:** `{ snapshotId: string }`
- **Response:** `200 OK` with `DrDrillResult` (RPO, RTO, verification match).

---

## 9. UI

### 1. Incident Time Machine & Replay Console (`apps/web/src/app/worlds/[worldId]/replay/page.tsx`)
- **Spec alignment:** §75 (Incident Time Machine & Replay Console).
- **Layout:**
  - **Top Scrub Bar:** Interactive time-slider representing the experiment timeline ($T_0$ to $T_{\text{end}}$):
    - Checkpoint markers (diamonds on the timeline).
    - Injected fault markers (red flags).
    - Current playhead cursor with microsecond readout.
  - **Playback Controls:** `Rewind (|<)`, `Play/Pause (1x)`, `Fast-Forward (>>)`, `Step Frame (>|)`.
  - **Side-by-Side State Diff View:**
    - Left: Historic Run State.
    - Right: Current Replay State.
    - Live Merkle Root Hash comparison badge (Green **"IDENTICAL (0x8f2a...)"** or Red **"DIVERGED"**).
  - **Fork Button ("Branch Scenario"):** Allows operator to pause at $T=15\text{s}$, edit Orders circuit breaker,
    and simulate a new counterfactual timeline.

### 2. DR Drill & RPO/RTO Scorecard (`apps/web/src/app/worlds/[worldId]/dr/page.tsx`)
- **Visuals:**
  - Large RPO Metric Card: `RPO: 1.2s (Well within 5.0s Target)`.
  - Large RTO Metric Card: `RTO: 1,420ms (Target: < 5,000ms)`.
  - "Simulate Catastrophic Failure" drill trigger button with confirmation modal.
  - Snapshot catalog table with download button for offline cold-storage archives.

---

## 10. Steps

1. **Create `packages/recovery` package:** Initialize package structure, dependencies, and tsconfig.
2. **Implement Merkle Checkpoint Generator:** Build component serialization and SHA-256 root tree calculation.
3. **Implement Deduplicated Storage Manager:** Build content-addressable storage skipping identical component payloads.
4. **Build Deterministic Replay Engine:** Wire checkpoint loader to simulation `FastDriver`.
5. **Implement Checkpoint Bisection Tool:** Build binary search algorithm across snapshots.
6. **Implement Full-Text Search Service:** Implement PostgreSQL `tsvector` queries across past incident records.
7. **Implement Disaster Recovery Simulator:** Build snapshot restoration and RPO/RTO measurement engine.
8. **Database migration `012_recovery.sql`:** Add tables and indexes for snapshots and DR tracking.
9. **Build Control Plane Recovery endpoints:** Implement API routes for snapshots, replay, bisection, and DR drills.
10. **Build Incident Time Machine UI:** Implement `apps/web/src/app/worlds/[worldId]/replay/page.tsx`.
11. **Build DR Scorecard UI:** Implement `apps/web/src/app/worlds/[worldId]/dr/page.tsx`.
12. **Implement `npm run verify:recovery` gate script:** Automated verification suite validating the recovery platform.

---

## 11. Testing

### Unit tests (`packages/recovery/tests/unit`)
- `merkle-tree.test.ts`: Verify identical component states always yield identical Merkle root hashes.
- `dedup.test.ts`: Assert unchanging components are marked `is_deduplicated = true` with zero payload duplication.
- `bisector.test.ts`:
  - Create two simulated 100-checkpoint runs where run 2 introduces 1-byte drift at checkpoint #64.
  - Assert bisector identifies checkpoint #64 in exactly $\lceil\log_2(100)\rceil = 7$ iterations.

### Integration tests (`apps/control/tests/integration/recovery`)
- Capture snapshot, wipe active world state in Postgres, execute DR restore, assert all services and edges recover cleanly.
- Assert replay to $T=20\text{s}$ matches original run's state hash.

---

## 12. Gate

Command: `npm run verify:recovery`

The gate test validates these 5 recovery platform assertions:

```typescript
// tests/gates/verify-recovery.ts

// Assertion 1: Deterministic rewind and replay reproduces exact canonical Merkle state hash
assert(replayStateHash === originalStateHash, 'Assertion 1: Replay reproduces exact state hash bit-for-bit');

// Assertion 2: Checkpoint bisection pinpoints injected 1-tick drift to exact entity
assert(bisectionResult.componentId === 'orders' && bisectionResult.simTimeMicros === targetDriftMicros,
  'Assertion 2: Bisection isolates divergent component and timestamp');

// Assertion 3: Incremental snapshots achieve >= 80% payload deduplication across successive ticks
assert(deduplicationRatio >= 0.80, 'Assertion 3: Incremental snapshot storage deduplication verified');

// Assertion 4: Disaster Recovery restores fully functional world from cold snapshot
assert(restoredWorldHealthy && restoredWorldServiceCount === originalCount,
  'Assertion 4: DR restore cleanly reconstitutes operational world');

// Assertion 5: DR drill certifies RPO <= 2s and RTO <= 3000ms
assert(drResult.rpoMicros <= 2_000_000n && drResult.rtoMs <= 3000,
  'Assertion 5: DR drill certifies RPO and RTO within target bounds');
```

---

## 13. Pitfalls

1. **Serializing non-deterministic elements into snapshots:** Serializing OS timestamps, auto-incrementing
   DB sequences, or unsorted JSON keys will produce different Merkle hashes for identical domain states.
   Always sort keys and strip non-model metadata.
2. **Snapshot storage bloat:** Capturing full state dumps without deduplication quickly exhausts disk space.
   Ensure content-addressable deduplication is active.
3. **Replaying out-of-order events:** Inbound workload events must be strictly queued by microsecond timestamp
   when fed back to the simulator during replay.
4. **Destructive DR drills:** DR simulations must execute in an isolated sandbox or transactional dry-run
   to prevent accidental deletion of live active worlds.

---

## 14. Done

- [ ] `packages/recovery` compiles under strict TypeScript with 0 errors.
- [ ] Incremental Merkle checkpointing deduplicates $> 80\%$ of unchanging components.
- [ ] Replay engine restores past states and verifies bit-for-bit canonical hash identity.
- [ ] Checkpoint bisection tool pinpoints exact divergent component in $O(\log N)$ steps.
- [ ] Disaster recovery drills certify operational recovery with mathematical RPO and RTO.
- [ ] Migration `012_recovery.sql` applied cleanly in Postgres.
- [ ] Incident Time Machine scrub bar and DR Scorecard active in web UI.
- [ ] `npm run verify:recovery` runs green in CI with all 5 gate assertions passing.
