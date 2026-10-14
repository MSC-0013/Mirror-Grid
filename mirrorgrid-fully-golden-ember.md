# MIRRORGRID — Implementation Plan

## Context

`C:\MSC\Main project\Mirror-Grid` is empty. This plan builds MIRRORGRID from zero:

> A local-first distributed-systems reliability laboratory that models production-like service
> architectures, generates controlled workloads, injects deterministic failures, observes failure
> propagation, measures reliability, and reconstructs state through snapshots and event replay.

The goal is a portfolio artifact that demonstrates distributed systems, reliability engineering,
concurrency, observability, performance engineering and disaster recovery at a level that survives
interview scrutiny. The spec supplied (142 architecture sections + 85 UI sections) is the
requirements document; this is the execution plan for it.

### The thesis that makes this project defensible

Most "chaos dashboard" projects script their own failures: the UI shows P95 rising to 1.8s because
someone wrote `p95 = 1800`. MIRRORGRID's central technical claim is the opposite —

**The numbers are emergent, and the run is reproducible.**

Latency, queue growth, saturation, retry amplification and cascading failure fall out of a bounded
-concurrency queueing model advanced by a virtual clock. Nothing is scripted. And because every
source of nondeterminism is seeded and recorded, the same experiment replays to an identical
**canonical state hash**. Those two properties are what separate this from a dashboard, and every
milestone below is ordered to protect them.

### Prior art in your own repos — read before writing

Two sibling projects contain directly relevant work. Mining them is faster than rebuilding, and one
of them is genuinely close to M2/M4 territory:

| Source | What to take |
|---|---|
| `ApexPerf/server/simulation/` | Digital-twin **queueing simulation** — the closest existing thing to MIRRORGRID's sim engine. Read before writing `packages/sim`. |
| `ApexPerf/server/chaos/` | Chaos Fault Lab + chaos-ladder. Fault taxonomy and escalation logic to port. |
| `ApexPerf/workers/load-worker` (Go) | Workload generation patterns; the Go version informs the TS design. |
| `ApexPerf/server/coordination/` | Distributed coordination primitives. |
| `NEXUS/apps/api/**` | **The backend template.** Fastify 5 + Drizzle + postgres.js + BullMQ + ioredis + JWT + `@fastify/websocket`, 32 modules, 20 numbered SQL migrations with RLS. This is your proven stack — MIRRORGRID's `apps/*` should look like it. |
| `NEXUS/docker-compose.yml` | Best compose file you've written: healthchecks, `depends_on: service_healthy`, `${VAR:-default}` interpolation. Start from it. |

ApexPerf's backend is plain `.mjs` with no types, so this is a **port, not an import** — read the
algorithms, rewrite them typed and clock-injected. But do not design `packages/sim` from a blank page.

### Explicit risks this plan is designed against

Your four sibling projects show three repeating patterns. Each gets a countermeasure.

**Risk 1 — Backend integration is the consistent stall point.** infrasight/Pulse is the clearest
case: 19k LOC and 26 polished pages, `supabase-queries.ts` written at 541 lines, **0 of 29 routes
importing it**, 24 of 29 still on `mock-data.ts` (1,178 lines). Last commit — *"updated schema and
implementation plan for backend"* — is the moment work stopped. ApexPerf shows the same shape:
`packages/*` contains zero source files.

> **Countermeasure — the no-mock rule. There is no `mock-data.ts` in this repo, ever.**
> The frontend calls the real API from M0, even when that API returns two rows of seed data.
> A screen is not built until its endpoint exists. This one rule is the difference between
> MIRRORGRID and infrasight, and it is non-negotiable.

**Risk 2 — Claimed completion outruns reality.** ApexPerf's README carries "Implementation 100.00%"
and "273/273 PASS" badges, self-certified by a manifest it generates itself — beside an empty
`packages/` and a Helm chart with one template. Pulse's README is an all-✅ matrix over
`queues.service.ts` at 12 lines of passthrough.

> **Countermeasure — gates you cannot self-certify.** Every milestone ends in an executable gate:
> a command that prints a number or a test that passes. CI runs the gates and publishes the
> artifact; README status is **generated from CI output**, never hand-edited. No percentage badges.
> A milestone is done when its gate runs green, not when its files exist.

**Risk 3 — Enormous plans, thin execution.** 100–122 KB plan files (`PLAN.md.txt`, `project details.txt`,
`implementation-plan`) are the house habit. NEXUS is the proof this *can* work — 82 commits, real
production fixes, 13k LOC of API behind its docs — but it's one for four.

> **Countermeasure — no technology is added until something measurable breaks without it.**
> Kafka arrives when the outbox has a consumer that lags. OpenSearch arrives when a measured
> Postgres FTS query is too slow (M11 records the comparison).
>
> **No enum-value-only integrations.** A full-text scan of Pulse for
> `kafka|nats|opensearch|minio|otel|prometheus|grafana|clickhouse` found hits in exactly five
> places: landing-page marketing copy (10), README §12 "Future Enterprise Roadmap" as unchecked
> boxes (4), a `QueueType` Prisma enum (2), and one seeded queue row (1). **Zero hits in any
> compose file, any backend source file, or any config directory.** Every distributed technology
> beyond Postgres and Redis existed as a string in a data model or a line of prose — never a
> running service, a client library, or a config file. That is the precise failure mode the
> profile-per-milestone rule exists to prevent.
> And no codegen-seeded module shells — ApexPerf/Pulse's `generate-modules.mjs` emitted 20 module
> templates, 9 of which were never filled. Write each module in the milestone that needs it.

**Risk 4 — this plan is itself a large plan.** The house habit is 100–122 KB plan files that become
substitutes for implementation, and this document is now long enough to join them.

> **Countermeasure — the abstraction-depth rule.**
> *No milestone may introduce more than one layer of abstraction ahead of a working feature.*
> No Kafka before there is an event worth publishing. No upcasters before there are two event
> versions. No RCA engine before there are traces to analyse. No replay UI before replay works.
> If a milestone's deliverable has no consumer inside that same milestone, it is deferred.

**Also carried over:** `login.credential.md` sits committed in ApexPerf's root in plaintext.
MIRRORGRID runs `gitleaks` in CI from the first commit and ships only `.env.example`.

---

## Hard constraints (measured on this machine)

| Resource | Value | Consequence |
|---|---|---|
| RAM | 15.6 GB total, ~1.2 GB free at rest | Full stack needs an explicit memory budget |
| Docker memory | WSL2 default = ~50% of RAM, **no `.wslconfig` present** | Raised and pinned at M8, when the event stack lands |
| CPU | i5-13420H, 8 physical / 12 logical | Fine; sim engine is single-threaded per world |
| Disk | 76.9 GB free | Images + volumes ≈ 25 GB. Adequate, watch it |
| Docker Desktop | Installed, **not running**, `AutoStart: false` | `docker desktop start` is step 0 of any infra work |
| Node / npm | v24.12.0 / 11.6.2 | Corepack 0.34.5 present → pnpm available |
| Also present | git 2.52, kubectl 1.36, kind 0.32 | No Go toolchain → TypeScript everywhere |

### Decision: Compose profiles, brought online progressively

*(Revised. The earlier version of this plan ran the complete stack from M0; that is reversed.)*

Declared container limits are not total system consumption — WSL2 overhead, the Windows filesystem
cache, the IDE, a browser, the Next.js dev server and `tsc` all sit outside them. Booting thirteen
services on day one also makes M0's gate answer the wrong question: *"can Docker Desktop start the
world?"* instead of *"does my vertical slice work?"*

So services are grouped into profiles and started only when a milestone integrates them:

```bash
docker compose --profile core up -d          # M0  postgres
docker compose --profile cache up -d         # M6  + redis
docker compose --profile events up -d        # M8  + kafka, nats
docker compose --profile obs up -d           # M9  + otel, prometheus, grafana, jaeger
docker compose --profile runtime up -d       # M3  + toxiproxy
docker compose --profile search up -d        # M11 + opensearch, minio
docker compose --profile full up -d          # M13 everything, for the campaign
```

The compose file still *defines* every service from M0 — no enum-only fake integrations — but
nothing runs before its milestone. OpenSearch in particular does not start until M11 proves it's
needed (§83; M11 records the measured Postgres-FTS comparison).

**`C:\Users\HP\.wslconfig` — created at M8, not M0.** Editing it requires `wsl --shutdown`, which
kills Docker and any running containers, so it is deliberately deferred to the first milestone that
actually needs headroom rather than imposed on day one:

```ini
[wsl2]
memory=10GB
processors=8
swap=4GB
```

**Per-service budget — every compose service gets an explicit `mem_limit`:**

| Service | Limit | Notes |
|---|---|---|
| postgres:18 | 512m | `shared_buffers=128MB` |
| redis:7-alpine | 192m | `maxmemory 128mb`, `allkeys-lru` |
| kafka (KRaft, single broker) | 1g | `KAFKA_HEAP_OPTS=-Xmx512m` |
| nats:jetstream | 128m | |
| opensearch (single-node) | 1280m | `-Xms512m -Xmx512m`, security plugin off |
| minio | 256m | |
| prometheus | 512m | 7d retention, 15s scrape |
| grafana | 256m | |
| jaeger all-in-one (badger) | 512m | |
| otel-collector | 256m | |
| toxiproxy | 64m | Container-mode network faults |
| app services × 6 | ~1.5g | Node, ~256m each |
| **Docker total** | **≈ 6.7 GB** | Fits 10 GB WSL with headroom |

That total is the **M13 `full` profile ceiling**, not the day-one footprint. M0 runs ~512 MB
(Postgres alone). The budget exists so the full profile is reachable at the end, not so it must be
paid at the start.

---

## Pinned versions

Verified against the registry on 2026-09-15 rather than assumed. Two are non-obvious and matter:

| Package | Version | Note |
|---|---|---|
| Node | 24.12.0 | Installed |
| **TypeScript** | **5.9.3** | **Not 7.0.2.** `typescript-eslint@8.70` peers `typescript >=4.8.4 <6.1.0` — adopting TS 7 silently disables type-aware linting, which is a core anti-hollowness control. Revisit when typescript-eslint supports 7. |
| Next.js | 16.3.5 | Active LTS; React peer `^19.0.0` |
| React / React DOM | 19.3.0 | |
| Fastify | 5.12.4 | |
| **zod** | **4.6.5** | **Not 3.24.** `fastify-type-provider-zod@7` peers `zod >=4.1.5`. Your siblings used zod 3; this is an upgrade. |
| fastify-type-provider-zod | 7.0.0 | + `@fastify/swagger` 9.8.1 → **OpenAPI 3.1 for free** |
| Drizzle ORM / Kit | 0.45.2 / 0.31.10 | |
| postgres (pg driver) | 3.4.9 | |
| PostgreSQL | **`postgres:18.6`** | Pin the exact patch tag in compose, never `:18`. Floating tags make "same git commit" stop meaning "same stack". |
| **Kafka client** | **`@confluentinc/kafka-javascript` 1.10.1** | **Not `kafkajs`.** kafkajs was last published **2023-02-27** — ~3.5 years stale. Confluent's official librdkafka binding published 2026-09-10 and ships a KafkaJS-compatible API, so the migration cost is near zero. An unmaintained Kafka client is precisely what gets probed in an interview. |
| nats | 2.29.3 | |
| ioredis | 6.0.0 | |
| @grpc/grpc-js | 1.14.4 | |
| dockerode | 5.0.1 | |
| @opentelemetry/sdk-node | 0.222.0 | |
| Turborepo | 2.10.13 | |
| Vitest | 5.0.0 | Needs Vite ≥6 |
| Playwright | 1.63.0 | |
| ESLint / typescript-eslint | 10.10.0 / 8.70.0 | |
| Prettier | 3.9.6 | |
| pino | 10.3.1 | |
| testcontainers | 12.1.0 | Integration tests |

---

## Architecture decisions

These are recorded as ADRs in `docs/adr/` as they're made — the one documentation habit that
distinguishes a record from a plan.

### AD-1 — Two planes, deliberately separated

The spec's control-plane/data-plane split (§77) is load-bearing and easy to lose. Stated sharply:

```
MIRRORGRID the platform          │  The World being experimented on
─────────────────────────────────┼──────────────────────────────────
Real distributed system.         │  Modeled system (or real containers).
Real Kafka, real Postgres,       │  "Payments", "Orders", "Gateway".
real workers, real leases.       │  Latency and failure are emergent.
Chaos here is REAL:              │  Chaos here is INJECTED:
  kill the broker, kill a pod.   │    +1500ms on Payments.
Proves: I can build one.         │  Proves: I can break and measure one.
```

Both are required, and the spec's Phase-20 campaign mixes them (Experiments 005/006/007 are
platform-plane; 001–004 are world-plane). Naming them **world-plane chaos** and **platform-plane
chaos** keeps the failure campaign coherent and is worth saying out loud in an interview.

### AD-2 — Both runtimes are peers behind one port

Per your decision, LOGICAL and CONTAINER are equal from the start. They are kept honest by a single
interface plus a **conformance suite both adapters must pass** (`tests/contract/runtime-adapter.conformance.ts`).
That suite is what makes "peers" a fact rather than an aspiration.

```ts
// packages/domain/src/runtime/runtime-adapter.ts
export interface RuntimeAdapter {
  readonly mode: RuntimeMode;                 // LOGICAL | CONTAINER | HYBRID
  readonly clock: Clock;                      // VirtualClock | SystemClock
  readonly capabilities: RuntimeCapabilities;

  provision(spec: WorldSpec): Promise<RuntimeHandle>;
  start(h: RuntimeHandle): Promise<void>;
  applyWorkload(h: RuntimeHandle, w: WorkloadSpec): Promise<WorkloadHandle>;
  applyFault(h: RuntimeHandle, f: FaultSpec): Promise<FaultHandle>;
  removeFault(h: RuntimeHandle, f: FaultHandle): Promise<void>;
  observe(h: RuntimeHandle): AsyncIterable<RuntimeSample>;
  health(h: RuntimeHandle): Promise<ServiceHealth[]>;
  teardown(h: RuntimeHandle): Promise<void>;
}

export interface RuntimeCapabilities {
  determinism: 'DETERMINISTIC' | 'SEEDED_INPUTS' | 'NON_DETERMINISTIC';
  maxServices: number;            // LOGICAL ~1000  | CONTAINER ~8
  maxWorkloadRate: number;        // LOGICAL ~50k/s | CONTAINER ~2k/s
  supportedFaults: FaultType[];
  supportsReplayVerification: boolean;
  forcedDriver?: 'REALTIME';      // HYBRID cannot run under the fast driver
}
```

Capability negotiation is how the asymmetry stays honest rather than hidden: CONTAINER reports
`SEEDED_INPUTS`, and the UI says *"Same inputs, real timing — latency will vary"* instead of
implying a guarantee it cannot make (the three classes are defined in the Determinism contract
below). Conversely CONTAINER supports genuinely real `CPU_PRESSURE`, `CONNECTION_RESET` and OOM
kills that LOGICAL only models. Neither mode is the "fake" one; they trade different things, and the
UI states the trade.

### AD-3 — Determinism is designed in at M2, never retrofitted

Virtual clock + splittable seeded PRNG + canonical state hashing land before any feature that
consumes them. Retrofitting determinism into a system that already calls `Date.now()` and
`Math.random()` across 40 files is effectively a rewrite, which is why M2 sits this early.

### AD-4 — One reliability library, two consumers

`packages/reliability` (CircuitBreaker, RetryPolicy, Bulkhead, TokenBucket, Deadline) is written
once against an **injected clock**. The simulation drives it with the virtual clock; MIRRORGRID's own
service-to-service calls drive it with the system clock. Same code, two planes — so a circuit breaker
unit test is deterministic *and* the production path is the tested path.

**The core/shell split is what makes this actually work.** The obvious API —
`async execute<T>(fn: () => Promise<T>)` — is a trap: it forces promises into the simulation, and
promises mean microtask scheduling, which a discrete-event engine cannot order deterministically.
So each primitive is two pieces:

- **Core** — a *synchronous, pure* state machine. No I/O, no timers, no promises. `tryAcquire(nowMs)`
  → admission decision; `onResult(nowMs, outcome)`; `snapshot()` / `restore()`; `writeCanonical()`
  so its state hashes directly into the world hash.
- **Shell** — a thin `async` wrapper used *only* by real services, holding a `Clock` and awaiting the
  actual call.

One further detail keeps the core pure: the breaker's `OPEN → HALF_OPEN` transition is evaluated
**lazily on read**, not via a scheduled timer. A timer would drag the engine's event heap into the
primitive; lazy evaluation makes the core a pure function of `(previous state, now)` — trivially
hashable, trivially restorable, and identical whether `now` comes from `Date.now()` or a virtual
clock.

Three call sites, one implementation: the deterministic engine, the synthetic service container, and
MIRRORGRID's own calls to Docker, Toxiproxy, Kafka and MinIO. The control plane is protected by the
very primitives it simulates — so a bug in the retry policy shows up in MIRRORGRID's own logs, not
only in a simulation nobody is watching.

### AD-5 — Simulated metrics do not go to Prometheus

World metrics must be snapshot-able, replayable and exactly reproducible. Prometheus scrape jitter
would break that and Prometheus cannot be replayed. Therefore:

- **World-plane metrics** → in-memory per-second buckets during a run, flushed to Postgres
  (`experiment_metrics`), archived to MinIO with the report.
- **Platform-plane metrics** (MIRRORGRID's own services) → OTel → Prometheus → Grafana.

This is AD-1 applied to telemetry, and it is the reason replay can verify metrics at all.

### AD-6 — Drizzle + hand-written SQL migrations

Per your decision. Drizzle for typed queries, plain `.sql` migration files for everything the spec
demands that an ORM obscures: `FOR UPDATE SKIP LOCKED`, advisory locks, partial indexes, statement
timeouts, `EXPLAIN ANALYZE` tuning. Pulse's 772-line `schema.prisma` — far larger than what its
services actually queried — is the failure mode being avoided: tables land in the milestone that
queries them.

---

## Repository layout

```
mirrorgrid/
  apps/
    web/                 Next.js 16 console
    gateway/             Fastify — auth boundary, rate limit, routing, WebSocket
    control/             Worlds, services, dependencies, experiments, policies, snapshots
    simulation/          Runtime orchestration, workload + fault engines
    query/               Read models, search, dashboards, reliability reports
    worker/              Background jobs, leases, retries, scheduling
    runtime-agent/       Container lifecycle, Toxiproxy control, resource telemetry
    synthetic-service/   The configurable container image a CONTAINER-mode World runs
  packages/
    sim/                 PURE — discrete-event engine, clock, RNG, queueing, hashing
    reliability/         PURE — breaker, retry, bulkhead, deadline, token bucket
    domain/              World-plane model: worlds, services, graph, experiments
    platform/            Platform-plane contracts: health, capabilities, correlation,
                         execution context, resource limits, platform events
    config/ db/ auth/ events/ messaging/ grpc/
    logging/ observability/ validation/ testing/
  proto/                 runtime.proto, control.proto, worker.proto
  schemas/               events/ api/ commands/  (versioned JSON Schema)
  infrastructure/        compose/ kafka/ nats/ postgres/ redis/ opensearch/
                         minio/ prometheus/ grafana/ otel/ toxiproxy/
  deploy/kind/           cluster.yaml, deployments, services, hpa, pdb, network-policies
  tests/                 unit/ integration/ contract/ e2e/ concurrency/
                         load/ chaos/ security/ recovery/
  docs/                  architecture/ adr/ api/ events/ operations/
                         runbooks/ experiments/ benchmarks/
```

`packages/sim` and `packages/reliability` are the intellectual core — pure, dependency-free,
clock-injected, and the most heavily unit-tested code in the repo.

**Purity is enforced, not requested.** Both packages have zero runtime dependencies, and a CI check
fails the build if that changes:

- ESLint `no-restricted-imports` bans `fastify`, `drizzle-orm`, `postgres`, `ioredis`,
  `@confluentinc/kafka-javascript`, `nats`, `@opentelemetry/*` inside `packages/sim` and
  `packages/reliability`.
- ESLint `no-restricted-globals` bans `Date` and `Math.random` inside `packages/sim`.
- `dependency-cruiser` enforces the layering: `sim` and `reliability` may not import any other
  workspace package; `domain` may import them; apps may import anything.

`packages/platform` exists because AD-1 splits the system into two planes, and without it the
cross-plane contracts (health semantics, runtime capabilities, correlation identity) accumulate in
`domain` and blur the boundary the whole architecture rests on.

---

## Conventions

Carried forward from your existing work where they're good, tightened where Pulse showed gaps.

**Keep — NEXUS is the backend template.** It is your most-shipped project (82 commits, real
production fixes) and already runs the exact stack this plan needs:
- **npm workspaces** (`apps/*`, `packages/*`) — as in NEXUS and ApexPerf. Not pnpm: no sibling
  project uses it, and corepack adds friction for no gain here. Add **Turborepo** on top purely for
  task orchestration and caching, which matters across ~14 packages.
- Fastify 5 + Drizzle + postgres.js + ioredis + `@fastify/websocket` + JWT — NEXUS's proven set.
- Numbered SQL migrations `001_*.sql` → `0NN_*.sql`, as in `NEXUS/database/migrations`.
- Module shape (from Pulse, documented and consistent): `<name>.routes.ts` / `.controller.ts` /
  `.service.ts` / `.repository.ts` / `.schema.ts` + `index.ts` barrel exporting `<name>Routes`.
- Shared core: `core/utils/response.ts`, `core/utils/pagination.ts`,
  `core/errors/app-error.ts` (static factories: `AppError.notFound(...)`),
  `core/errors/error-handler.ts`, `core/middleware/{auth,rbac,api-key}.middleware.ts`.
- Env: zod `safeParse` → `process.exit(1)` on failure → single frozen `config` export.
- Routes under `/api/v1`; `/health` outside the prefix. kebab-case filenames throughout.
- TS strict, `NodeNext`, explicit `.js` import extensions in backend code.
- Compose conventions from `NEXUS/docker-compose.yml`: healthchecks, `depends_on: service_healthy`,
  `${VAR:-default}` interpolation.

**Reuse the app-shell patterns** you've built twice (infrasight + NEXUS) — they're proven and the
spec asks for them anyway: Cmd+K command palette (spec §60), right-side inspector drawer (§23, §69),
`can(perm)` RBAC sidebar filtering (§53), global time-range selector (§39).

**Two deliberate departures from house style**, because the spec is explicit:
- **Next.js 16 App Router, not TanStack Start.** The spec names Next.js and wants server components
  for world metadata/reports with client components only for live surfaces (§107).
- **Light mode is primary, not dark-first.** Spec §63 is unambiguous. Your house aesthetic is
  dark-first enterprise; MIRRORGRID's is white/black/gray with semantic status colour only (§86).
  A dark topology/trace mode comes later (§64) with identical semantics.

**Add (absent in every sibling project):**
- Prettier + `.editorconfig`; ESLint on **both** frontend and backend with
  `@typescript-eslint/no-unused-vars` **on**. Every sibling sets `noUnusedLocals`/`noUnusedParameters`
  to `false` and Pulse had no backend ESLint at all — that's how 12-line passthrough services
  survive review.
- GitHub Actions CI from commit one: typecheck, lint, unit, integration, contract, gitleaks.
  **No sibling project has any CI.** This is the single biggest process upgrade available.
- `.gitignore` covering `.next/`, `.vercel/`, `.output/`, `dist/` — Pulse and MSCx0013 committed
  build output.
- `CLAUDE.md` at the root recording these conventions.
- `docs/adr/NNN-*.md` written when a decision is made, not reconstructed later.
- Real commit hygiene: ApexPerf is 3 commits in one day; commit per coherent change here.
- **Executable API contract.** zod schemas are the single source of truth: route schemas via
  `fastify-type-provider-zod@7` → `@fastify/swagger` emits **OpenAPI 3.1** at `/openapi.json`,
  committed to `schemas/api/openapi.json`. Contract tests assert the served spec matches the
  committed one, so drift fails CI. Frontend types are generated from that spec — which is what
  makes the no-mock rule cheap to honour instead of laborious.
- `dependency-cruiser` layering rules (see Repository layout).

**Frontend design tokens** (spec §2, §86) as CSS variables in `apps/web/src/styles/tokens.css`:
`#FFFFFF` bg, `#111111` primary, `#6B7280` secondary, `#E5E7EB` border, `#F8F9FA` surface;
semantic `#16A34A / #D97706 / #DC2626 / #2563EB / #64748B`. Borders over shadows, 8px radius,
strict 4/8/12/16/20/24/32/40/48/64 spacing scale. Status is always **icon + text**, never colour
alone (spec §21) — which is also the accessibility win.

---

## Data model — the mechanisms that matter

Full DDL is written per-milestone in `packages/db/migrations/0NN_*.sql`. Five mechanisms carry the
system's correctness and are decided here rather than improvised later.

**1. Per-world monotonic event sequence.** `events` has `UNIQUE(world_id, sequence)`. The counter
lives on the `worlds` row and is allocated inside the same transaction as the event:

```sql
UPDATE worlds SET event_seq = event_seq + 1 WHERE id = $1 RETURNING event_seq;
```

The row lock serializes concurrent writers per world, so sequences are gapless and ordered — which
is exactly what replay requires. A Postgres sequence would be faster but gaps on rollback, and a
gapped sequence makes "snapshot @ N + events N+1..M" unverifiable.

> **Stated invariant: ordering is PER-WORLD, never global.** All writers to one world contend on
> that world's row; different worlds never contend. This is an accepted, documented trade-off —
> single-writer throughput per world in exchange for a gapless ordered history, which is the thing
> replay actually needs. Kafka partitioning by `world_id` (M8) preserves the same guarantee
> downstream. Claiming global ordering would be both false and unnecessary.

**2. Outbox polling.** `event_outbox(status, next_attempt_at)` as a **partial** index
`WHERE status = 'PENDING'`, so the publisher's hot query never scans published rows — the table grows
without the poll slowing down.

**3. Job claiming.** Lease-based, with a partial index on `(status, next_attempt_at) WHERE status = 'READY'`:

```sql
UPDATE jobs SET status = 'CLAIMED', worker_id = $1,
       lease_until = now() + interval '30 seconds', attempt_count = attempt_count + 1
WHERE id = (
  SELECT id FROM jobs
  WHERE status = 'READY' AND next_attempt_at <= now()
  ORDER BY priority DESC, next_attempt_at
  FOR UPDATE SKIP LOCKED LIMIT 1
) RETURNING *;
```

`SKIP LOCKED` is what lets N workers claim concurrently without blocking each other; the lease is
what lets a crashed worker's job be reclaimed. A separate sweeper returns expired leases to `READY`.

**4. Idempotency.** An `idempotency_keys` table keyed `UNIQUE(user_id, key, endpoint)` storing the
response status and body. A replayed request returns the stored response rather than re-executing —
required for start/stop experiment, snapshot create/restore and chaos execution (§99).

**5. Metric time-series — two representations, honestly labelled.**

*(Corrected. An earlier draft claimed fixed histogram buckets yield **exact** quantiles. They do
not: bucket counts locate the rank's bucket but not the sample's position within it. Buckets are
mergeable; they are not exact.)*

`experiment_metrics` stores per-second, per-service rows carrying **both**:

| Field | Representation | Quantile quality |
|---|---|---|
| `samples` | Raw latency values, `int[]` of microseconds | **Exact** P50/P95/P99/P99.9 |
| `histogram` | Log-linear bucket counts, `int[]` | **Bounded relative error** (±1% with γ=1.02), mergeable |

- **LOGICAL mode retains raw samples** and computes **exact** quantiles. Volume is controlled and
  deterministic, so this is affordable — and exactness is what makes two replayed runs comparable
  at the quantile level rather than merely close.
- **CONTAINER and platform-plane metrics** use the histogram, because volume is unbounded. Reported
  values are labelled *estimated* in the API and the UI, with the error bound stated.
**Explicit retention tiers**, because raw samples at 5,000 req/s are ~18M values/hour/service and
cannot be kept indefinitely:

| Stage | Held | Quantiles |
|---|---|---|
| Active run | Raw samples in memory, flushed per second | Exact |
| Completed run, < 7 days | Raw samples in Postgres | Exact |
| Completed run, > 7 days | Histogram + summary only; raw dropped | Bounded error |
| Archived | Histogram + report bundle in MinIO | Bounded error |

Degradation is one-way and labelled: a report generated after the window says *estimated*, and the
experiment record notes the date raw samples were dropped. Long-lived experiments lose precision
gracefully rather than being deleted — but they never silently claim exactness they no longer have.

The histogram's real virtue is **mergeability** — bucket arrays sum across seconds and services and
still yield a valid quantile, which averaging pre-computed percentiles cannot. That property is
worth keeping; "exact" was the overclaim.

Partitioned by `experiment_run_id`; old partitions archived to MinIO and dropped.

**6. Immutable experiment configuration and provenance.** When an experiment starts, its entire
configuration is **frozen into the run row**, never referenced by live foreign key. If a service's
retry policy changes mid-flight, the run must still describe what it actually executed:

```
experiment_runs:
  frozen_config      jsonb     -- world topology, edge policies, workload, fault schedule,
                               --   AND detector cadence + stabilization rule (see M5)
  config_hash        text      -- sha256 of canonical frozen_config
  seed               bigint
  runtime_mode       text      -- LOGICAL | CONTAINER | HYBRID
  engine_version     text      -- packages/sim version, incl. ICDF table hash
  schema_version     int
  git_commit         text
  lockfile_hash      text      -- package-lock.json digest
  image_digests      jsonb     -- CONTAINER/HYBRID only:
                               --   {"synthetic-service":"sha256:…","runtime-agent":"sha256:…"}
```

`image_digests` and `lockfile_hash` exist because **the same git commit does not guarantee the same
running artifact** — a rebuilt image or a floating transitive dependency changes behaviour with no
commit to blame. Provenance that stops at the commit hash is provenance that fails exactly when you
need it.

So a report reads:

```
Experiment #104   Engine 1.3.0   Git a81f2d7   Seed 42
Runtime LOGICAL   Config sha256:9f2c…   Schema v8
```

Without this, an experiment is reproducible only until the next config edit — which is to say, not
reproducible. This is the cheapest possible insurance on the project's central claim.

**7. Clock domains — never mix virtual and wall time.** The system now carries at least five kinds of
time, and conflating them would quietly corrupt MTTD, MTTR, replay and cross-plane correlation. Every
timestamp therefore declares its domain, and the event envelope (§27) gains a `clockDomain` field:

| Domain | Source | Used by |
|---|---|---|
| `WORLD_VIRTUAL` | `VirtualClock`, integer µs from run start | Logical simulation events, world metrics, MTTD/MTTR |
| `PLATFORM_WALL` | System clock, UTC | MIRRORGRID's own service events, audit, jobs, outbox |

Paired fields on every event:

- **`occurredAt`** — when it happened, *in its own domain*. For a logical world event this is virtual
  time; for a platform event it is wall time.
- **`recordedAt`** — always `PLATFORM_WALL`: when it was persisted.

Two consequences that matter: experiment durations are computed **entirely within `WORLD_VIRTUAL`**,
so a simulation that ran 1000× faster than real time still reports a truthful 23.4s MTTR; and
correlating a world event with a platform event is an explicit, deliberate join through
`recordedAt` rather than an accidental subtraction of two incomparable numbers.

A `CHECK` constraint rejects any event whose `clockDomain` doesn't match its aggregate type.

**State machines** are enforced with `CHECK` constraints plus a transition table in
`packages/domain`, not Postgres `ENUM` types — enums require a migration to extend and can't express
*which* transitions are legal. `COMPLETED → RUNNING` is rejected in code and the column constraint
catches anything that slips past (§16, §115.1).

---

## Fault matrix — how each fault is applied in each mode

Both runtimes accept the same declarative `FaultSpec`; the adapter translates. This table is the
honest statement of what each mode can and cannot do, and it drives the capability reporting in AD-2.

| Fault | LOGICAL | CONTAINER | Notes |
|---|---|---|---|
| `LATENCY` | Add to service-time distribution | Toxiproxy `latency` toxic | Both faithful |
| `ERROR_RATE` | Bernoulli draw from seeded RNG | Synthetic-service admin API | Both faithful |
| `SERVICE_CRASH` | Mark FAILED, drop in-flight | Docker `kill` | Container is real |
| `SERVICE_RESTART` | FAILED → STARTING → HEALTHY | Docker `restart` | Container includes real cold start |
| `TIMEOUT` | Deadline exceeded in model | Toxiproxy `timeout` toxic | Both faithful |
| `PACKET_LOSS` | Probabilistic drop | Toxiproxy `slicer` + `bandwidth` | Container closer to real TCP |
| `CONNECTION_RESET` | Modeled error class | Toxiproxy `reset_peer` | **Container only genuinely real** |
| `CPU_PRESSURE` | Reduce effective concurrency | Docker `update` CpuQuota (cgroup throttle) | **Container only genuinely real.** Throttles one container without stealing host CPU from the other eleven — and is exactly reversible |
| `MEMORY_PRESSURE` | Reduce capacity | Docker `update` Memory (+ swap off) | **Container only.** Below current RSS this OOM-kills — a legitimate fault, detected via Docker events, exit 137 |
| `QUEUE_BACKLOG` | Pre-fill queue | Pause synthetic consumer | Both faithful |
| `CONSUMER_PAUSE` | Halt consumption | Kafka consumer pause | Platform-plane too |
| `CACHE_EVICTION` | Flush modeled cache | `redis-cli FLUSHDB` on the World's Redis | — |
| `DATABASE_LATENCY` | Add to DB edge | Toxiproxy on the DB proxy | Both faithful |
| `DATABASE_UNAVAILABLE` | Mark dependency FAILED | Disable that edge's DB proxy | One service loses its DB while others keep working |
| `NETWORK_PARTITION` | Remove graph edge | Disable all cross-group proxies | Supports asymmetric partitions |

**The wiring decision that makes this work: a proxy per dependency *edge*, not per service.** Every
edge in CONTAINER mode routes through its own Toxiproxy listener. Three things follow that a
per-service proxy could not give:

1. **The whole network-fault family needs no `NET_ADMIN` and no privileged containers** — which
   matters because `tc netem` under Docker Desktop/WSL2 requires privileges this plan deliberately
   does not take (§15: the backend converts a declarative fault into a controlled implementation; it
   never executes arbitrary commands).
2. **Asymmetric partitions are expressible**, because `A→B` and `B→A` are separate proxies. The
   default partition mode is *blackhole* (hang until the client deadline), not *refuse* — real
   partitions don't send RST, and the difference between failing fast and hanging is the difference
   between a blip and a cascade.
3. **Dependency failure can be scoped to one consumer.** Disabling `orders→postgres` leaves
   `payments→postgres` healthy. Stopping the Postgres container could never express that asymmetry,
   and asymmetry is where the interesting incidents live.

**The one exception, and it stays optional:** faithful `PACKET_LOSS` (retransmit timers,
congestion-window collapse, dup-ACK fast retransmit) does need `NET_ADMIN` — applied to a
**disposable sidecar** sharing the target's network namespace, never to the service container.

- **Default (`APPROXIMATED`)** — `slicer` + `bandwidth` + `reset_peer`, no privileges, labelled
  *approximated* in the UI with the derived proxy parameters shown alongside the requested loss rate.
- **`REAL_PACKET_LOSS`** — an **advanced, opt-in mode** behind an env flag, gated on a kernel probe
  for `sch_netem`.

**M3 does not depend on the privileged path.** Its gate passes entirely on the approximated default,
so a machine that can't run netem still completes the milestone. Both modes are approximations of
real loss anyway, and the report says which one produced the numbers rather than treating a container
run as ground truth.

Every fault carries `fault_id`, `experiment_id`, `target`, `type`, `parameters`, `started_at`,
`expires_at`, `status`, `created_by` (§14), and a sweeper enforces expiry independently of the
experiment process (§115.3).

---

## Determinism contract

The guarantee, stated precisely so it can be tested and so the UI can report it honestly:

> Given the same World definition, the same seed, the same workload spec and the same fault schedule,
> a LOGICAL run produces an identical sequence of events and an identical **canonical state hash**,
> on the same engine version and platform.

**What that does and does not promise.** The guarantee is over the *canonical representation* —
a defined projection of state that MIRRORGRID controls and serializes deliberately. It is **not** a
claim about byte-identical JS heap contents, object layout or runtime internals, none of which are
observable or controllable. "Deterministic canonical state hash" is the precise claim; "byte-identical
state" would be a claim the project cannot inspect, let alone keep.

**Seeded, splittable PRNG.** A root seed derives named substreams by hashing the stream name with the
seed. Consumers take `rng.stream('workload:gateway')`, `rng.stream('service:payments:latency')`.
Substream isolation is the non-obvious requirement: without it, adding a new random consumer anywhere
shifts every downstream draw and silently invalidates comparison against earlier experiments.

**Virtual clock, two drivers.** A binary-heap event queue ordered by `(time, priority, sequence)` —
a *total* order, so simultaneous events are never ambiguously ordered. `RealtimeDriver` paces advance
to 1× wall clock for the live UI; `FastDriver` drains the heap as fast as possible for replay and CI.
Identical engine, identical results, ~1000× difference in runtime.

> **Stated invariant — the realtime driver controls the *rate* of advancement and nothing else.**
> `VirtualClock` remains the sole authority on simulation time. No wall-clock value ever enters model
> state, influences a branch, or reaches the hash. When the realtime driver falls behind (a 5,000 rps
> burst on a laptop) it **executes the backlog as fast as it can** — it never drops, reorders,
> coalesces or skips events. Lag is surfaced in the UI as an honesty indicator
> (*"running behind wall clock — displayed timing is compressed"*) and is explicitly **not** hashed.
>
> This is what makes driver equivalence true rather than hopeful, and it is asserted directly by
> `verify:determinism` gate 7: the same run under both drivers must produce the same hash.

Pausing in realtime mode simply stops advancing virtual time; nothing in the hashed state is aware it
happened.

**No floating point in the hashed state — and no transcendental functions anywhere on the sampling
path.** *(Strengthened. An earlier draft said "quantize floats before hashing", which is too weak:
an un-quantized float can change a branch — `latency > threshold` — and diverge the run long before
anything is hashed.)*

`Math.log`, `Math.exp` and `Math.pow` are **not** correctly rounded under IEEE-754, so V8 on x64,
V8 on ARM64 and a future V8 may each differ in the last ULP. One ULP can cross an integer-microsecond
boundary, reorder two heap events, and diverge everything downstream. That is the single most likely
cause of "it replayed differently in CI", so it is designed out rather than patched:

- **Distributions are sampled from pre-generated integer inverse-CDF tables**, not computed. Table
  generation runs offline, may use `Math.log` freely, and the *output integers* are the contract.
  The table is hashed into `engine_version`, and for user-supplied parameters the table bytes are
  stored in the run's frozen config so a replay uses the original table rather than regenerating it.
- **Time** is integer microseconds throughout (exact below 2^53; 285 years of range).
- **Probabilities** are fixed-point integers in parts-per-billion; an error roll is an integer
  comparison against a precomputed threshold.
- **Token buckets** hold integer micro-tokens, so no drift accumulates over a long run.
- Any user-supplied float is quantized **once at the config boundary**, and only the integer is used
  thereafter. `NaN`/`Infinity` are rejected there rather than silently coerced.
- The canonical serializer types its `float()` method as `never` — passing a float is a compile error.

Floats reappear only at the reporting boundary (chart payloads, report values), derived from exact
integer counters and never fed back in.

**Canonical state hash — Merkle, not flat.** Each component (a service, an edge, a breaker, the
event heap, the RNG registry, the fault set) is hashed independently and the root is the hash of the
sorted `(key, componentHash)` pairs. Serialization is length-prefixed binary with sorted map keys
(sorted by UTF-8 bytes, never `localeCompare`) — not JSON, whose number formatting is lossy and key
order is only conventionally stable.

The Merkle structure pays for itself during replay verification: **checkpoint bisection**. Hashes are
checkpointed every N events, so a divergence is binary-searched to the first bad checkpoint, then the
component hashes there name the exact service or edge that drifted, then a per-event replay over that
narrow window names the exact event. The output is *"edge `orders→payments`, event 6,118, field
`retryBudgetTokens`"* rather than *"the worlds differ."*

**Emergent behaviour, not scripted.** Each service has bounded concurrency and a bounded queue.
The load-bearing rule is this one:

> **A concurrency slot is held for the entire request span — including time spent waiting on
> downstream calls, retries and backoff.**

That single rule is the whole cascade mechanism, because capacity is then just arithmetic:

```
capacity = concurrency / occupancy

Orders, healthy:   64 slots /  20ms  = 3,200 req/s   (500 req/s offered → 16% utilized)
Orders, degraded:  64 slots / 900ms  =    71 req/s   (500 req/s offered → collapsed)
```

Nothing was reconfigured. Orders' capacity fell 45× because a slow dependency made it hold each slot
longer. From there the rest follows with no cascade-specific code at all:

```
Payments service time ↑ → Orders deadline exceeded → Orders retries
  → Payments offered load ↑ (amplification) → Payments queue saturates
  → breaker threshold crossed → circuit OPEN → Gateway fast-fails in µs
  → Gateway occupancy collapses back to ~1ms and it RECOVERS while Orders is still failing
  → load shed upstream → Payments queue drains → HALF_OPEN probes → CLOSED
```

Two details in that chain are worth demonstrating explicitly because they are what separates an
understanding of these primitives from a recital of them:

- **The breaker protects the *caller*, not the callee.** Gateway recovers first, while Orders is
  still on fire. That is what breakers are actually for, and the topology view should show it.
- **The retry budget is why amplification self-limits.** With a budget, amplification caps near 1.2×;
  with it disabled, the uncapped 3× collapse is visible. Running both and comparing is the single
  most instructive experiment the tool can produce — and M10's comparison engine makes it one click.
- **HALF_OPEN against a still-slow dependency produces a limit cycle** — open/probe/fail/open on the
  cooldown period. Nothing schedules that oscillation; it emerges, and it is the most recognizable
  signature of a real production incident.

This is why `verify:determinism` gate 4 checks Little's Law on a steady-state fixture: if the
queueing model is real, `L ≈ λW` must hold; if the numbers were curve-fitted, it won't.

**What CONTAINER mode offers instead: reproducible *inputs*, non-reproducible *outputs*.**

Real containers cannot be byte-reproducible — OS scheduling, V8 JIT tier-up, GC pause placement, TCP
connect timing, keep-alive socket reuse, Docker daemon latency and eight-core contention among
twelve containers are all outside the seed. But the *plan* is fully reproducible, and it is committed
to disk **before** the run executes and hashed as `input_plan_hash`:

- every request's arrival time, id, path and payload size
- every fault's type, parameters, start and duration, including probabilistic blast rolls
- per-edge call-probability outcomes and routing choices
- retry jitter (each container seeded from the run seed + its service id)
- trace and request ids

So two container runs are compared **statistically, never by equality**: exact match on
`input_plan_hash`, then per-metric tolerances (p50 ±15%, p99 ±30%, error rate ±3pp, throughput ±10%,
recovery ±25%) plus a two-sample Kolmogorov–Smirnov test on the merged latency distributions.
`final_state_hash` is `NULL` for container runs, enforced by a DB constraint so the two claims can
never be confused.

**Three determinism classes, surfaced as a badge on every run and carried into exported reports:**

| Class | Applies to | Claim |
|---|---|---|
| `DETERMINISTIC` | LOGICAL | "Byte-identical on replay. State hash `blake3:7f3a…` matched across 2 runs." |
| `SEEDED_INPUTS` | CONTAINER, HYBRID | "Same inputs, real timing. Workload, faults and request ids reproduce exactly (`plan:a41f…`); measured latency and error rates vary run to run." Clicking shows the actual deltas and KS result — not a generic disclaimer. |
| `NON_DETERMINISTIC` | Runs whose input plan couldn't be fixed | Reason stored and shown inline. |

**HYBRID is the subtle case and gets an explicit rule.** The moment a logical service awaits a real
HTTP call, the logical side inherits wall-clock timing and event ordering becomes machine-dependent.
So HYBRID is **forced to the realtime driver and `SEEDED_INPUTS`**, and the API rejects a fast-driver
hybrid run with a 422 explaining why. Its logical half is still seeded and its inputs still reproduce;
its hash does not, and is not written.

A lab whose headline claim is reproducibility has to be exact about which claim it is making. The
schema, the API and the UI all encode that distinction, so a result never travels without its
epistemic status attached.

---

## Milestones

Fourteen milestones. Each states its goal, deliverables with real paths, the design decisions that
matter, and an **executable gate**. Spec phases (§113) are remapped: determinism moves from Phase 11
to M2 because everything downstream depends on it, and the container runtime moves from Phase 7 to
M3 because you chose peer runtimes.

**Defined vs. running:** `infrastructure/compose/docker-compose.yml` **defines** every service from
M0 — no enum-only fake integrations, the way Pulse listed `kafka`/`nats` as enum values with no
broker behind them. But each service only **starts** in the milestone that integrates it, via its
compose profile. So the stack is real from day one and the laptop only pays for what's in use.

Each milestone below names the profile it turns on.

---

### M0 — Foundation and walking skeleton

**Goal:** log in, create a World, see it in a list — through the real API, with CI green.

**Deliverables**
- Repo init: `git init`, npm workspaces (`apps/*`, `packages/*`), `turbo.json` pipeline
  (`build`, `dev`, `lint`, `typecheck`, `test`).
- Root config: `tsconfig.base.json` (strict, `NodeNext`, `noUnusedLocals`/`noUnusedParameters`
  **true**), flat `eslint.config.js` for both tiers, `.prettierrc`, `.editorconfig`, `.gitignore`,
  `CLAUDE.md`, `.env.example`.
- `.github/workflows/ci.yml` — **PR suite only** at this stage: typecheck → lint →
  dependency-cruiser → unit → integration (testcontainers) → gitleaks.
- `infrastructure/compose/docker-compose.yml` — defines every service with healthcheck,
  `depends_on: service_healthy`, `${VAR:-default}` and `mem_limit`, but **only the `core` profile
  (PostgreSQL 18) starts.** Modelled on `NEXUS/docker-compose.yml`.
- `packages/config` — zod `safeParse` env → frozen `config`; `packages/logging` — pino 10 with
  `traceId`/`requestId`/`service` fields (spec §81); `packages/validation`; `packages/platform` —
  health and correlation contracts; `packages/db` — Drizzle over postgres.js + `001_core.sql`.
- `apps/gateway` — Fastify 5, request-id middleware, error handler, `/api/v1` routing,
  `@fastify/swagger` serving **OpenAPI 3.1** at `/openapi.json`.
- `apps/control` — auth module + worlds module (full six-file shape, no shells).
- `apps/web` — Next.js 16.3, login page, app shell (sidebar §8, top bar §10, system-status
  indicator §12), dashboard §13, worlds list §15, create-world modal §16. Types generated from
  the OpenAPI spec.

**Scope boundary — what M0 deliberately excludes.** *(Revised: M0 previously booted all thirteen
services.)* No Redis, Kafka, NATS, OpenSearch, MinIO, Prometheus, Grafana, Jaeger, OTel or
Toxiproxy. M0's gate must answer *"does my vertical slice work end to end?"*, not *"can Docker
Desktop start the world?"* The only running container is Postgres.

```
Next.js  →  Gateway  →  Control  →  PostgreSQL
```

**Design notes**
- **Auth = server-side sessions in Postgres + HTTP-only `SameSite=Lax` cookie**, not JWT. NEXUS used
  JWT, but spec §55 requires logout invalidation and session rotation, which stateless tokens can't
  do without a revocation list. API keys (M6) cover automation. Passwords hashed with argon2id.
- Only `001_core.sql` exists here: `organizations`, `users`, `organization_members`, `sessions`,
  `worlds`. The other ~20 tables land in the milestone that queries them.
- The dashboard shows real counts from real rows. If there's one world, it says one.

**Health semantics — defined now, because partial failure depends on them later**

| Probe | Question | Fails when |
|---|---|---|
| `/health/live` | Is the process alive? | Event loop wedged, unrecoverable state. **Never** because a dependency is down. |
| `/health/ready` | Can this service perform its role *right now*? | A **required** dependency is unavailable |
| `/health/status` | What is each dependency's state? | Never — it reports, it does not fail |

Each service declares dependencies as `required` or `degraded`. A `degraded` dependency going down
moves the service to `DEGRADED` in `/health/status` and leaves readiness green. So when Kafka stops
in M8, the control API stays ready and the UI says *"Event delivery delayed"* — the §78 partial
-failure behaviour, which is impossible to retrofit if liveness was wired to dependencies at M0.

**Gate — `npm run verify:m0`**
1. `docker compose --profile core up -d` → Postgres healthy in under 30s.
2. Migrations apply to a clean DB; re-running is a no-op.
3. Playwright: sign in → create World "Metro-01" → appears in list → reload persists it.
   **No `mock-data.ts` exists in the repo** (asserted by a grep test that fails the build).
4. `/health/live`, `/health/ready`, `/health/status` return correct shapes; stopping Postgres turns
   readiness red while liveness stays green.
5. Served `/openapi.json` matches `schemas/api/openapi.json` (contract drift fails CI).
6. CI green on a pushed commit.

---

### M1 — Domain model and topology

**Goal:** define a six-service World with dependencies and see it as an interactive graph.

**Deliverables**
- `migrations/002_topology.sql`: `services`, `service_instances`, `service_dependencies`,
  `workloads`, with `UNIQUE(world_id, service_name)`, `UNIQUE(source_service_id, target_service_id)`,
  and a self-edge `CHECK`.
- `packages/domain` — entities and **state machines as data**: `WorldStatus` (§8), `ServiceStatus`
  (§9, all eight states incl. `PARTIALLY_AVAILABLE` per §79), with an explicit transition table so
  `COMPLETED → RUNNING` is rejected by construction (§16).
- `packages/domain/src/graph/` — the dependency-graph algorithms that later power analysis:
  `detectCycles`, `topologicalOrder`, `reachableFrom` (blast radius), `criticalPath`,
  `dependentsOf`. Pure functions, heavily unit-tested.
- `packages/domain/src/runtime/runtime-adapter.ts` — the port from AD-2. **Interface only**; both
  implementations land in M2/M3.
- `apps/control` — services, dependencies, workloads modules.
- `apps/web` — topology page (§19) with React Flow, node design (§20), status states (§21),
  hover/click/double-click/shift-click interactions (§22), service drawer (§23).

**Design notes**
- Edges carry policy, not just shape: `timeout_ms`, `retry_policy`, `criticality`,
  `circuit_breaker_policy` (§10). These are the inputs M2's simulation consumes — defining them here
  means M2 has real data to run on.
- Cycle detection matters: a cyclic dependency graph makes the simulation non-terminating. Reject at
  the API with 422 and a named cycle path.
- React Flow layout: deterministic hierarchical layout (dagre) so a World's topology looks the same
  every time it's opened.

**Gate — `npm run verify:m1`**
1. Seed the §10 topology (Gateway → Orders/Users, Orders → Inventory/Payments, Payments → Postgres)
   via the **API**, not SQL.
2. Topology renders all six nodes and eight edges; node shows instance count and status.
3. `POST` a dependency creating a cycle → 422 naming the cycle.
4. `reachableFrom('payments')` unit test returns the expected dependent set.
5. Deleting a service with dependents → 409, never a dangling edge (invariant §115.2).

---

### M2 — Deterministic logical runtime

**The intellectual core.** Everything after this consumes it.

**Goal:** run a World at 500 logical req/s with emergent latency and queueing, and prove the same
seed produces the same state hash.

**Deliverables**
- `packages/sim/src/clock.ts` — `VirtualClock` + binary-heap event queue; `RealtimeDriver` (pinned
  to 1× wall clock for the live UI) and `FastDriver` (drains as fast as possible for replay/CI).
  One engine, two drivers.
- `packages/sim/src/rng.ts` — **splittable seeded PRNG**. Substreams derived by hashing a stream
  name with the root seed, so adding a new random consumer never perturbs existing streams. Without
  this, adding a feature silently invalidates every prior experiment comparison.
- `packages/sim/src/queueing.ts` — bounded-concurrency service model: arrivals, queue depth, service
  -time distribution, departure scheduling. **This is what makes the numbers emergent** — saturation,
  backpressure and cascading failure fall out of it rather than being written down.
- `packages/sim/src/metrics.ts` — per-second buckets retaining **raw latency samples** for exact
  quantiles in LOGICAL mode, plus the mergeable log-linear histogram for aggregation and for the
  modes where sample retention is unaffordable (see Data model §5).
- `packages/sim/src/hash.ts` — canonical state hash (sorted keys, quantized floats → SHA-256).
- `packages/sim/src/workload.ts` — CONSTANT / RAMP_UP / RAMP_DOWN / BURST / SPIKE / RANDOM (§11).
- `apps/simulation` — `LogicalRuntimeAdapter implements RuntimeAdapter`, world lifecycle, run loop.
- `migrations/003_runtime.sql` — `experiment_metrics` time-series table (design in the Data Model
  section below).
- `apps/web` — live metrics on the world overview, fed by polling (WebSocket arrives M8).

**Design notes**
- Read `ApexPerf/server/simulation/` first — it's a digital-twin queueing simulator and the nearest
  existing implementation. Port the model; rewrite typed and clock-injected.
- **Float determinism:** IEEE-754 `+ - * /` are reproducible, but `Math.exp/log/pow` are not
  guaranteed identical across engines. Quantize every derived value (latency → integer microseconds)
  *before* it enters state or the hash. Replay on the same engine is then exact.
- `Date.now()` and `Math.random()` are **banned inside `packages/sim`** — enforced by an ESLint
  `no-restricted-globals` rule, which is how the ban survives contact with a deadline.

**Gate — `npm run verify:determinism`**
1. Run the same World, seed and workload twice with `FastDriver` → **identical state hashes**.
2. Change only the seed → hash differs.
3. Add a new RNG substream → pre-existing streams produce unchanged values (substream isolation).
4. **Little's Law check — on a dedicated steady-state benchmark, not an arbitrary run.**
   *(Refined: Little's Law assumes a stable system over the measurement window, which bursts,
   startup, failure propagation and recovery all violate.)* The fixture uses a constant arrival
   rate, a fixed population, a discarded warm-up period and a separate measurement window; only
   then is `L ≈ λW` asserted within 2%. Transient scenarios are explicitly excluded from this check.
5. Scale: 1,000 logical services at 5,000 req/s completes in `FastDriver` under 60s.
6. `RealtimeDriver` holds 1× wall clock within 5% drift over 2 minutes.
7. **Driver equivalence:** the same run under `FastDriver` and `RealtimeDriver` produces the
   identical canonical state hash. Drivers differ in *when* they step, never in *what* steps.

---

### M3 — Container runtime, as a true peer

**Goal:** the same World definition runs as real Docker containers, passing the same conformance
suite as the logical adapter.

**Deliverables**
- `apps/synthetic-service` — the configurable container image a CONTAINER World is built from:
  dependency list, per-edge timeout/retry/breaker, latency distribution, error rate, concurrency
  limit. Surface: `/health/live`, `/health/ready`, `/call`, `/metrics`, admin fault endpoints on a
  separate port bound to the internal network only. One image, N configured instances — this is what
  makes real containers tractable without writing eight bespoke microservices.
  Propagates W3C `traceparent` plus three MIRRORGRID headers: `mg-request-id` (stable across retries
  and fanout), **`mg-deadline-at`** (an *absolute* timestamp, so the budget correctly shrinks down
  the call tree rather than resetting at each hop), and `mg-fault-ids` (the evidence trail M10's
  attribution consumes). Its `/metrics` histogram boundaries are **identical to the simulation's**,
  so container and logical runs merge onto one chart and are directly comparable.
  Crucially, it applies the same slot-held-through-downstream-wait rule as the engine — so both
  runtimes cascade for the same reason, not merely to the same shape.
- `apps/runtime-agent` — gRPC service (`proto/runtime.proto`) owning: container lifecycle via
  dockerode, network faults via the **Toxiproxy** HTTP API, app-level faults via the synthetic
  service's admin API, and resource telemetry.
- `ContainerRuntimeAdapter implements RuntimeAdapter`, reporting
  `determinism: 'SEEDED_INPUTS'`, `maxServices: 8`.
- **`tests/contract/runtime-adapter.conformance.ts`** — one suite, run against both adapters. This
  is what makes "peers" verifiable rather than claimed.
- HYBRID mode: logical engine treats a containerized service as an external call over real HTTP.

**Design notes**
- **Every dependency edge is routed through Toxiproxy.** That single wiring decision buys latency,
  bandwidth, slow-close, timeout, reset-peer and slicer toxics with **no `NET_ADMIN`, no privileged
  containers** — which matters on Docker Desktop/WSL2 where `tc netem` is painful. `NETWORK_PARTITION`
  additionally uses `docker network disconnect`.
- Fault mechanism per type is tabulated in the Fault Matrix section below, including what container
  mode genuinely reproduces that logical mode only models (real CPU/memory pressure, real TCP resets)
  and what it gives up (determinism).
- The UI must say *"Observational replay — timing will differ"* for CONTAINER runs. Honest capability
  reporting is a feature, not a caveat.

**Gate — `npm run verify:m3`**
1. The conformance suite passes against **both** adapters.
2. A six-container World serves 500 real req/s with P95 recorded.
3. Toxiproxy latency toxic on Orders→Payments, asserted as **two separate claims**:
   a. **Edge latency** — the measured `orders→payments` span duration increases by the configured
      toxic latency ±10%. This is the mechanism check, and it is the one that can be exact.
   b. **End-to-end P95 increased**, directionally — with no claim that it equals
      `baseline + injected`.
   *(Corrected: the earlier gate asserted aggregate P95 ≈ baseline + injected ±10%. That is not a
   sound expectation — queueing, retries, connection setup and concurrency saturation all reshape
   the end-to-end distribution, so the aggregate can legitimately move far more than the injected
   amount. Measure the injection where it is injected; observe the cascade separately.)*
4. `SERVICE_CRASH` → container exits, health goes `FAILED`, restart returns it to `HEALTHY`.
5. Capabilities endpoint reports the two modes' differing limits, and the UI renders the difference.
6. `docker stats` during the run stays inside the M0 memory budget.

---

### M4 — Reliability mechanisms and the fault engine

**Goal:** one reliability library running in both planes, and a fault engine that is safe by
construction.

**Deliverables**
- `packages/reliability` — `CircuitBreaker` (CLOSED/OPEN/HALF_OPEN, §21), `RetryPolicy` (exponential
  backoff + jitter + budget + error classification, §20), `Bulkhead` (§23), `TokenBucket`,
  `Deadline` (§22), `LoadShedder`. **Every one takes an injected `Clock`** (AD-4) — so the simulation
  drives them with virtual time and MIRRORGRID's own HTTP/gRPC calls drive them with system time.
- `packages/domain/src/errors/classification.ts` — the §80 taxonomy (TRANSIENT / PERMANENT /
  BUSINESS / INFRASTRUCTURE / TIMEOUT / RESOURCE_EXHAUSTION / AUTH* / VALIDATION /
  DEPENDENCY_FAILURE) driving retry decisions.
- `migrations/004_faults.sql` — `faults` with `expires_at`, `status`, `created_by`.
- `apps/simulation/src/fault/` — the fault engine: declarative spec → controlled application via the
  runtime port, TTL enforcement, auto-expiry sweep, emergency stop (§51).
- Chaos safety boundary (§15, §50): a closed enum of fault types with validated parameters. Never a
  free-form command. Plus max duration, max targets, max concurrent experiments, protected targets
  (control-plane DB, auth service).

**Design notes**
- The circuit breaker is the highest-value unit-test target in the repo: with an injected clock, its
  full state machine including cooldown and half-open probes is testable in microseconds, with no
  sleeps and no flakes.
- Retry classification is the subtle part — retrying a validation error is a bug, and retry
  amplification under latency is precisely the cascading-failure mechanism the flagship demo shows.
- Auto-expiry needs a sweeper, not just a check-on-read: a fault whose experiment crashed must still
  expire (invariant §115.3).

**Gate — `npm run verify:m4`**
1. Circuit-breaker state machine: full transition coverage, deterministic, zero `sleep`.
2. Retry: TRANSIENT retried with backoff+jitter; VALIDATION never retried.
3. Bulkhead isolation — saturating the Payments pool leaves Inventory serving (§23).
4. A fault with `ttl=30s` auto-expires even when its experiment process is killed mid-run.
5. **Security test:** a fault payload carrying a shell command is rejected by schema, not sanitized.
6. Emergency stop cancels all active faults and workloads and writes an audit record.

---

### M5 — Experiment engine and the flagship demo

**Goal:** the §133 scenario, end to end, with measured numbers.

**Deliverables**
- `migrations/005_experiments.sql` — `experiments`, `experiment_runs` with validated state
  transitions (§16).
- `apps/control/src/modules/experiments` — lifecycle DRAFT → VALIDATING → SCHEDULED → RUNNING →
  STOPPING → COMPLETED, plus FAILED/CANCELLED paths; hypothesis, success criteria, expected behaviour.
- Criteria evaluator: declarative success criteria (`error_rate < 1%`, `recovery < 30s`,
  `circuit_breaker_opens`) evaluated against recorded metrics.
- Phase recorder (§35): baseline → injected → propagated → mitigated → degraded → removed →
  recovering → stabilized → measured. Phase boundaries are what MTTD and MTTR are computed from.
- `apps/web` — experiment builder wizard (§28), **live experiment view (§29–31)** — the hero screen:
  metric row, single timeline chart, event timeline, topology with failure highlight (§74).

**Design notes**

**The detector is part of the frozen configuration.** MTTD and MTTR are only reproducible if the
thing that *measures* them is itself deterministic — otherwise detector cadence becomes a hidden
nondeterministic input and two identical runs report different numbers. So `frozen_config` carries:

```
detector:
  evaluationIntervalUs: 100_000        # every 100ms of VIRTUAL time — never a UI poll interval
  breachCriteria:      [...]           # the SLO predicates being evaluated
  stabilizationWindows: 3              # consecutive passing windows required to declare recovery
```

With that fixed, the definitions become exact and defensible:

- **MTTD** = fault injection → *first evaluation tick at which a breach criterion became true*.
- **MTTR** = fault removal → *first tick beginning a run of `stabilizationWindows` consecutive
  passing evaluations*. Measured to sustained recovery, not to the first lucky green sample —
  which is what makes it a recovery time rather than a noise artefact.

Both are computed from recorded event timestamps in `WORLD_VIRTUAL`, never from a stopwatch in the UI.
- The live view is one chart plus a timeline, not fifteen charts (§30, §94). Restraint here is a
  design decision, not laziness.
- Retry amplification should be *visible*: Payments request rate rising above the offered load is
  the moment the demo lands.

**Gate — `npm run verify:flagship`** — scripted, headless, asserts on numbers:
1. Baseline Metro-01 at 500 req/s; record P95, error rate.
2. Inject Payments +1500ms.
3. Assert: Orders timeout rate rises; **Payments inbound rate exceeds offered load** (amplification);
   circuit opens within its configured window; queue depth grows.
4. Remove fault. Assert: HALF_OPEN → probes → CLOSED; queue drains; P95 returns within 10% of
   baseline.
5. Emit MTTD and MTTR as measured numbers and assert against the success criteria.
6. Run it twice with the same seed → identical hash **and** identical MTTD/MTTR.

Gate 6 is the whole thesis in one assertion.

---

### M6 — Security: RBAC, API keys, audit, rate limiting

**Goal:** chaos execution is an authorized, audited, rate-limited operation.

**Deliverables**
- `migrations/006_security.sql` — `roles`, `permissions`, `role_permissions`, `member_roles`,
  `api_keys` (hashed material only), `audit_logs`.
- `packages/auth` — permission catalogue (§53: `world.*`, `service.*`, `experiment.*`, `chaos.execute`,
  `snapshot.restore`, `audit.read`), role composition for OWNER/ADMIN/OPERATOR/VIEWER, `can(perm)`.
- `core/middleware/rbac.middleware.ts` (`requirePermission`) and `api-key.middleware.ts`.
- Rate limiting via Redis token bucket (§60): login 10/min/IP, API 100/min/user, chaos capped at
  5 concurrent experiments/user. **This is Redis's first real integration** — it earns its place here.
- Audit module (§82): append-only, `actor / action / resource / result / requestId / traceId /
  metadata`.

**Audit atomicity has a hard boundary, and the model respects it.** A Postgres transaction can
atomically commit a state change *and* its audit row. It **cannot** atomically span Postgres + NATS +
Docker + Kafka. So an operation with an external effect is audited in **two records, not one**:

```
BEGIN
  experiment.status = STARTING
  audit: ExperimentStartAccepted        <- COMMAND_ACCEPTED, atomic with the state change
  outbox: DispatchStartCommand
COMMIT
        ↓
   dispatch (NATS)
        ↓
   runtime agent executes
        ↓
  audit: ExperimentStartExecuted | ExperimentStartFailed   <- COMMAND_EXECUTED, separate record
```

*(Corrected: an earlier draft said audit rows are written "in the same transaction as the action
they record". True for pure DB actions; false the moment the action has an external effect — and
the failure it hides is the worst kind, an audit log asserting something happened when the dispatch
failed.)* `COMMAND_ACCEPTED` means the request was authorized and durably recorded. Only
`COMMAND_EXECUTED` means it took effect. The UI shows the distinction rather than collapsing it.
- Standardized error envelope (§54) that never leaks SQL, stack traces, hostnames or secrets.
- `apps/web` — settings: members, roles, API keys (§52, shown once), active sessions (§53), audit (§50).

**Design notes**
- `chaos.execute` and `snapshot.restore` are the permissions that actually matter; everything else is
  ordinary CRUD authorization.
- Audit in the same transaction is the difference between an audit log and a logging statement.

**Gate — `npm run verify:m6`**
1. VIEWER receives 403 on `POST /v1/experiments/:id/start`; OPERATOR succeeds.
2. An API key authenticates; its plaintext is unrecoverable from the DB; revocation is immediate.
3. Login rate limit trips at 11 attempts and recovers after the window.
4. Every §82 action appears in `audit_logs` with actor, request id and trace id.
5. A forced DB error returns a code + requestId and **no** SQL text (asserted by test).

---

### M7 — Async platform: jobs, leases, retries, DLQ

**Goal:** kill a worker mid-job and watch another worker reclaim it.

**Deliverables**
- `migrations/007_jobs.sql` — `jobs`, `job_attempts`, with the partial index for ready-job claiming
  and lease columns.
- `apps/worker` — claim loop using `SELECT ... FOR UPDATE SKIP LOCKED`, heartbeat-extended leases,
  exponential backoff with jitter, max attempts, DLQ transition (§17, §18, §25).
- Idempotency (§19, §99): `idempotency_key` on jobs and on mutating API endpoints, with replayed
  requests returning the original response rather than re-executing.
- Redis: cache-aside for dashboard reads, dedupe sets, short-lived locks with owner identity and
  expiry (§64).
- `apps/web` — workers page (§44), queue inspector (§45), DLQ inspect/retry/discard/replay (§25).

**Design notes**
- `FOR UPDATE SKIP LOCKED` rather than a Redis queue, deliberately: it keeps Postgres authoritative
  (Rule 1) and makes the concurrency test meaningful.
- **Never pretend a distributed lock exists when Redis is down** (§64). Lock acquisition failure
  fails the operation safely; it does not fall through to "probably fine."
- Redis outage degrades to cache-miss → Postgres, and that path is tested, not assumed.

**Gate — `npm run verify:concurrency`**
1. 8 workers, 1,000 jobs → **each logical job produces exactly one committed effect**
   (invariant §115.4). *(Corrected: not "executes exactly once".* A crash between performing a
   side effect and acknowledging it will cause re-execution — that is unavoidable in any
   distributed system, and claiming exactly-once *execution* would be false. What the system
   guarantees is exactly-once **effect**, achieved by making the domain operation idempotent and
   committing the state transition in the same transaction as the effect. The test asserts the
   committed effect count, and deliberately includes a kill-between-effect-and-ack case.)
2. `SIGKILL` a worker holding a lease → the job is reclaimed after lease expiry and completes.
3. Two simultaneous `POST /experiments/:id/start` → one transitions, the other is idempotent-rejected.
4. Replaying a request with the same `Idempotency-Key` returns the original response body.
5. `docker stop redis` → API still serves (cache-miss path); lock-requiring ops fail cleanly with a
   named error, not a silent success.

---

### M8 — Event platform: outbox, Kafka, CQRS, NATS, realtime

**Goal:** stop Kafka and lose zero events.

**Deliverables**
- `migrations/008_events.sql` — `events` (per-world monotonic `sequence`), `event_outbox` with its
  partial index.
- `packages/events` — the §27 envelope (`eventId`, `eventType`, `eventVersion`, `aggregateId`,
  `worldId`, `sequence`, `occurredAt`, **`recordedAt`**, **`clockDomain`**, `traceId`,
  `correlationId`, `causationId`, `payload`), versioned JSON Schemas in `schemas/events/`, and
  upcasters for v1→v2 (§28). `clockDomain` (`WORLD_VIRTUAL` | `PLATFORM_WALL`) is what lets a
  consumer join simulated world events against real platform events without silently subtracting two
  incomparable timestamps — see Data model §7.
- Outbox publisher (§29–30): domain change + outbox row in **one transaction**, publisher polls and
  publishes to Kafka with retry and `attempt_count`.
- Kafka topics (§26) partitioned by `world_id` for per-world ordering; consumer groups
  `query-projection`, `analytics`, `audit-indexer`, `experiment-engine`.
- CQRS projections (§31) into read models: `world_summary`, `service_health`, `experiment_summary`,
  `event_index`.
- `packages/messaging` — NATS JetStream for operational commands (§66) with correlation id, ack and
  timeout. **A publish returning locally is not success — and neither is a JetStream ack.**

  A JetStream publish acknowledgement means *the message was persisted by the broker*. It does not
  mean `InjectFault`, `RestartService` or `StopWorld` actually ran. Command state is therefore
  explicit and three-valued, and the API surfaces it:

  ```
  DISPATCHED  → broker accepted and persisted the command
  EXECUTED    → runtime agent ran it and reported success
  FAILED      → runtime agent ran it and reported failure (or the deadline passed)
  ```

  `POST /v1/experiments/:id/start` returns `202 DISPATCHED` with a command id; the terminal state
  arrives as an event. Treating broker durability as execution success is the single easiest way to
  build a control plane that lies about what it did.

- **Per-topic delivery semantics, declared rather than assumed** (§26):

  | Topic | Semantics | Consumer requirement |
  |---|---|---|
  | `mirrorgrid.domain` | at-least-once | idempotent projection, keyed by `eventId` |
  | `mirrorgrid.audit` | at-least-once | idempotent sink, unique on `eventId` |
  | `mirrorgrid.experiments` | at-least-once, per-world ordered | ordered by `sequence` within partition |
  | `mirrorgrid.telemetry` | at-most-once, best effort | lossy by design; never a source of truth |
  | `mirrorgrid.commands` | at-least-once + execution ack | dedupe by `commandId`; ack ≠ execution |

  "It's a Kafka topic" is not a design. Each topic's guarantee is documented in
  `docs/events/delivery-semantics.md` and asserted by contract tests.
- WebSocket (§108–110) in the gateway: `SERVICE_STATUS_CHANGED`, `METRIC_UPDATE`, `EVENT_CREATED`,
  `EXPERIMENT_PROGRESS`, `FAULT_STARTED/REMOVED`.
- `apps/web` — event explorer (§36), event detail drawer (§37), live experiment view switched from
  polling to WebSocket.

**Design notes**
- Sequence allocation is per-world and must not gap under concurrency — the mechanism is specified in
  the Data Model section.
- WebSocket is a **live projection, not a source of truth** (§109): on reconnect the client refetches
  current state, then resumes streaming. Tested against dropped and out-of-order messages.
- Degraded mode (§58, §78): Kafka down → control API, Postgres and dashboard stay available, events
  queue in the outbox, and the UI says *"Event delivery delayed — events are safely queued"* rather
  than showing green.

**Gate — `npm run verify:events`**
1. Commit a domain change → exactly one outbox row in the same transaction (invariant §115.5).
2. `docker stop kafka` → writes still succeed, outbox grows, UI shows degraded; restart → backlog
   drains, **zero events lost**, ordering per world preserved.
3. Deliver a duplicate event → the projection is unchanged (idempotent consumer).
4. Kill a consumer mid-batch → after rebalance, no gap in projected sequences.
5. A v1 event is consumed by a v2-aware consumer via the upcaster.
6. WebSocket: disconnect → reconnect → refetch → no UI state drift.

---

### M9 — Observability

**Goal:** one trace spans HTTP → gRPC → Kafka → worker, and a broken telemetry pipeline looks
broken rather than healthy.

**Deliverables**
- `packages/observability` — OTel SDK bootstrap for every service; context propagation across HTTP,
  gRPC, Kafka headers, NATS and worker jobs (§39).
- `infrastructure/otel/` collector config → Prometheus (metrics), Jaeger (traces), stdout/OpenSearch
  (logs). Grafana dashboards for the **platform plane** (AD-5).
- RED + golden-signal metrics (§40, §41) for MIRRORGRID's own services; distributed-system metrics:
  Kafka lag, worker utilization, retry count, DLQ depth, lease expiry, circuit state, cache hit rate,
  DB pool utilization.
- `apps/query` — trace lookup via the Jaeger API, metrics via the Prometheus HTTP API.
- `apps/web` — metrics page (§39, §94), trace waterfall (§38, §92), incident timeline (§132)
  generated from events.
- **Meta-observability (§76):** health of the telemetry pipeline itself, surfaced distinctly as
  "Telemetry degraded" so a collector outage can never read as "No incidents."

**Design notes**
- §76 is the easiest requirement in the spec to skip and one of the most interesting to have done —
  a false-negative observability failure is a real production trap.
- Jaeger all-in-one with badger storage, not Tempo: no object-store dependency and a simpler query
  API for the trace waterfall. Tempo is a later swap if wanted.

**Gate — `npm run verify:observability`**
1. One request produces a single trace spanning gateway → control → Kafka → worker, verified through
   the Jaeger API.
2. **Context survives the three cases where propagation actually breaks:**
   a. **Retry** — all attempts on one edge share the trace and carry distinct `mg-attempt` values;
      no attempt becomes a new root span.
   b. **Fan-out** — `Gateway → Orders → {Inventory, Payments}` and `Gateway → Users`: every
      downstream span has the correct parent, with no orphans.
   c. **Fan-in / async** — a Kafka-delivered event links back to the producing span via span links
      rather than a broken parent chain.
   Happy-path propagation almost always works; these three are where the bugs live.
3. Every structured log line in that path carries the same `traceId` and `requestId`.
4. Prometheus has RED metrics for all six services.
5. `docker stop otel-collector` → system health shows **"Telemetry degraded"**, not "Healthy".
6. Incident timeline for the flagship experiment is generated purely from stored events.

---

### M10 — Reliability engine: SLO, error budget, RCA, scoring, reports

**Goal:** an experiment produces a verdict with reasons, not a green tick.

**Deliverables**
- `migrations/009_reliability.sql` — `slo_definitions`, `reliability_measurements`.

  **An SLO is not a number — it is six fields.** "99.9%" alone is semantically empty, so
  `slo_definitions` requires all of:

  ```
  objective          99.9                    -- the target
  window             30d rolling | 5m experiment
  measurementSource  which SLI series, and from which plane
  aggregation        ratio of good events / valid events
  eligibility        which events count as valid
  failureDefinition  5xx + timeout = failure; 4xx = excluded
  ```

  Two window classes coexist deliberately: a **30-day rolling** window for a World's standing
  availability SLO and error budget, and a **per-experiment evaluation** window (default 5 minutes)
  for pass/fail verdicts. A verdict must say which window it evaluated, because the same run can
  pass one and fail the other — and that difference is usually the interesting finding.
- `packages/reliability/src/slo/` — SLI computation, SLO evaluation, error-budget consumption (§42,
  §43), availability, MTTD, MTTR, MTBF, failure frequency (§44).
- Blast-radius scoring (§128) over the M1 graph algorithms: direct / secondary / tertiary impact as a
  percentage of the topology.
- Root-cause inference (§37, §130): deterministic causal correlation over event timing, the
  dependency graph, `causationId` chains and fault configuration → a **ranked** hypothesis list with
  confidence. Deterministic first; no ML.
- **Attribution by evidence, ranked across multiple sources.** Every request carries an
  `mg-fault-ids` header that each hop appends to as faults touch it; intersecting the breaching
  requests' fault-id sets identifies the responsible fault directly. Time-window correlation guesses;
  a propagated evidence trail knows — and it stays correct when two faults overlap, which is exactly
  where correlation-based RCA falls apart.

  **But `mg-fault-ids` is not universal, and the engine must not treat it as truth.** Whole classes
  of failure have no originating request to carry a header:

  | Failure | No request trail because | Evidence used instead |
  |---|---|---|
  | Kafka consumer lag | Nothing is being served | Consumer-group offsets, lag series, `causationId` |
  | Background queue saturation | Async work, no caller | Queue depth, lease expiry, worker metrics |
  | DB connection-pool exhaustion | Failure is *acquiring* a connection | Pool gauges, error classification |
  | Cache stampede after eviction | Symptom appears on unrelated requests | Fault metadata, hit-rate series |

  So the RCA engine ranks hypotheses over **four** evidence sources — propagated fault ids,
  `causationId` chains, event-sequence adjacency in the dependency graph, and resource-metric
  correlation — and reports which source supported each hypothesis. A ranked list that shows its
  evidence is defensible; a single confident answer from one signal is not.
- Experiment score (§45, §33) from documented rules — detection, containment, recovery, availability,
  observability sub-scores. Rules live in `docs/experiments/scoring.md`; the UI renders them.
- Report generation (§85) → JSON + rendered view; archived to MinIO.
- Comparison engine (§122, §123): experiment A vs B, and architectural variants (retry=1 vs 3,
  2 workers vs 8, index vs no index).
- `apps/web` — reliability page (§40, §95), SLO detail (§41), failure-analysis view (§34), incident
  page (§35), blast-radius mode (§75), root-cause mode (§76), scorecard (§77).

**Design notes**
- Scores must be derived from published rules, not tuned to look good (§33, §45). The rules file is
  part of the deliverable — that's what makes the score defensible under questioning.
- The comparison engine is what turns MIRRORGRID from a demo into an engineering decision tool, and
  it's cheap once determinism exists: same seed, one variable changed.

**Gate — `npm run verify:reliability`**
1. A known-bad run yields `SLO: FAILED` with the specific breached objective named.
2. Error-budget arithmetic verified against hand-computed fixtures.
3. RCA ranks the injected fault first on the flagship scenario.
4. Blast radius on a 10-service World with 1 direct + 2 indirect = 30% (§128).
5. Two runs differing only in `retry: 1 → 3` produce a comparison showing the latency/error tradeoff.
6. Report JSON validates against its schema and round-trips from MinIO.

---

### M11 — Snapshot, replay, search, storage, disaster recovery

**Goal:** destroy the database and rebuild verified state.

**Deliverables**
- `migrations/010_snapshots.sql` — `snapshots` with `event_sequence` and `state_hash`.
- Snapshot bundle (§32): world metadata, service graph, config, experiment state, policies, runtime
  logical state, event sequence, **RNG stream positions** → MinIO at
  `worlds/{worldId}/snapshots/{snapshotId}`.
- Replay engine (§33, §34): snapshot @ N + events N+1..M → state; modes full / partial / from
  snapshot / until failure / until timestamp.
- **Replay divergence detection (§75):** recomputed hash vs recorded hash, with the first diverging
  event identified when they differ.
- OpenSearch indexing of events, audit logs, structured logs, reports (§83) — Postgres stays
  authoritative (Rule 1). **Include the measured Postgres-FTS-vs-OpenSearch comparison** in
  `docs/benchmarks/` so keeping it is evidence-based.
- DR (§71–74): `pg_dump`/restore automation, MinIO backup, the destroy→restore→replay→validate drill,
  RPO/RTO measurement, consistency checks via deterministic checksums.
- `apps/web` — snapshots page (§46), snapshot detail (§47), replay UI (§48), replay result (§49),
  global search (§11, §96).

**Design notes**
- A snapshot that omits RNG stream positions cannot replay deterministically — this is the detail
  most likely to be missed and it belongs in the bundle from the first version.
- **A backup is not real until a restore test passes** (§72). The DR drill is the deliverable; the
  backup file is not.
- **Database recovery and logical reconstruction are two different things and get two separate
  reports.** Collapsing them into one number would hide which mechanism actually worked:

  | | Database disaster recovery | Logical state reconstruction |
  |---|---|---|
  | Mechanism | `pg_dump` → restore | snapshot @ N + events N+1..M |
  | Failure it answers | The database was lost | Can this world's state be rebuilt and verified? |
  | Measured by | **RPO** (data lost) and **RTO** (time to serve) | **Replay correctness** — hash match or named divergence |
  | Can RPO be > 0? | Yes — anything since the last backup is gone | No — replay is exact or it has diverged |

  A report shows all four. "We recovered" is not a finding; "RPO 31s, RTO 94s, replay hash matched"
  is.

**Gate — `npm run verify:recovery`**
1. Snapshot @ seq 5000, run to 8421, replay from the snapshot → **hashes match** (§49).
2. Corrupt one replayed event → divergence is detected and the offending sequence named.
3. Full DR drill: create state → backup → `docker rm -f postgres` → restore → replay → validate,
   with **measured RPO and RTO printed**.
4. Post-recovery consistency: service count, dependency count, experiment state, event sequence and
   world hash all match pre-failure (§74).
5. Search returns the same event by id from OpenSearch and Postgres.

---

### M12 — Containers, Kubernetes, high availability

**Goal:** delete a pod under load and keep serving.

> **Historical caution:** no sibling project has working Kubernetes manifests — ApexPerf's Helm chart
> is `Chart.yaml` + `values.yaml` + one `namespaces.yaml`. This milestone is where the track record
> says things stop, so its gate is deliberately concrete.

**Deliverables**
- Dockerfile per service: multi-stage `node:24-alpine`, non-root user, healthcheck, resource limits,
  structured logging (§14).
- **Graceful shutdown (§67)** in every service: SIGTERM → stop accepting → drain in-flight → stop job
  claims → flush telemetry → close consumers → close pools → exit.
- `deploy/kind/` — cluster config, namespace, ConfigMaps, Secrets, Deployments, Services, Ingress,
  **HPA, PDB, NetworkPolicy** (§57, §68), rolling deployment strategy.
- Correct `readinessProbe` vs `livenessProbe` vs `startupProbe` semantics (§68) — alive ≠ ready.
- NetworkPolicy enforcing the §57 allowed edges; default deny.
- 2–3 replicas for stateless services (§69).

**Design notes**
- **Networking decision, made rather than left open:** the kind cluster runs **only the stateless
  application services**; every stateful service stays in Compose on the host.

  ```
  kind cluster                 Compose (host)
  ├── gateway   (3 replicas)   ├── postgres:18.6
  ├── control   (2)     ──────►├── redis
  ├── query     (2)            ├── kafka
  ├── simulation(2)            ├── nats
  └── worker    (2)            └── minio / observability
  ```

  Pods reach them through a single `ExternalName`/headless Service pointing at the host gateway
  (`host.docker.internal`), resolved once in a ConfigMap so there is exactly one place to change it.
  *(Previously this was left as two alternatives. Duplicating Postgres, Kafka and NATS inside kind
  would roughly double memory for no added insight — the milestone is testing **application** HA,
  probes, HPA, PDB and NetworkPolicy, none of which need in-cluster statefulness.)*
  kind and a second copy of the data stack never run simultaneously; 10 GB won't hold both.
- Graceful shutdown is what makes rolling deployments lossless; it's also directly testable, which is
  why it's a gate rather than a claim.

**Gate — `npm run verify:ha`** — stated as an SLO, not an absolute
1. `kubectl delete pod` on a gateway replica under 500 req/s, asserting:
   **error rate < 0.1%**, **zero 5xx on established idempotent requests**, and
   **recovery < 10s**, with the measured values printed.
   *(Corrected: "zero failed requests" was an overclaim.* Whether any request fails depends on
   load-generator connection reuse, ingress draining behaviour, shutdown timing and request
   semantics. An absolute guarantee would either be untrue or would quietly depend on a
   hand-tuned test environment. An explicit error budget is both honest and falsifiable.)
2. Rolling deployment under load → no dropped connections, in-flight requests complete.
3. Kill a worker pod mid-job → lease reclaim, job completes, no duplicate execution.
4. NetworkPolicy verified: web→control is blocked, gateway→control allowed.
5. SIGTERM to each service → clean exit within its grace period, no orphaned work.

---

### M13 — Performance, hardening, and the failure campaign

**Goal:** the numbers, the attacks, and the regression suite.

**Deliverables**
- `tests/load/` — the §46 benchmark ladder at 100 / 500 / 1k / 2.5k / 5k req/s, recording P50/P90/
  P95/P99/P99.9, throughput, errors, CPU, memory, DB latency, queue depth, Kafka lag.
- Baseline-then-one-change methodology (§47): each optimization gets before/after evidence.
  Concretely: `EXPLAIN ANALYZE` on the top five queries, one index at a time, recorded.
- Capacity experiments (§124): workers 1/2/4/8 → drain time, P95, throughput → a recommendation.
- Autoscaling experiment (§125): 500 → 2,000 req/s, measure HPA scale-up delay and latency recovery.
- Observability overhead benchmark (§126): tracing on vs off.
- `tests/security/` (§19, §59, Phase 19): authn bypass, RBAC bypass, SQL injection, command
  injection, SSRF, XSS, CSRF, rate-limit bypass, secret leakage, unsafe chaos execution, container
  image scanning.
- **`tests/chaos/campaign/` — the §113 Phase-20 suite as a regression suite**, split by plane:

  | Plane | Experiments | Count |
  |---|---|---|
  | **World-plane** (injected into a modeled World) | 001 Payment latency · 002 Payment crash · 003 Consumer pause · 004 DB slowdown · 008 Traffic burst · 009 Network loss · 010 Combined failure | **7** |
  | **Platform-plane** (real infrastructure stopped) | 005 Kafka outage · 006 Worker crash · 007 Redis outage | **3** |
  | | | **10** |

  World-plane is **001–004 and 008–010**, not a contiguous range — worth stating explicitly, since
  reading "001–004 are world-plane" as exhaustive would misclassify the last three.
- `docs/benchmarks/`, `docs/runbooks/` (§131), `docs/experiments/`.

**Design notes**
- Splitting the campaign by plane (AD-1) is what makes it coherent: 001–004 inject into a modeled
  World; 005–007 genuinely stop MIRRORGRID's own infrastructure. Both belong; conflating them doesn't.
- Once green, the campaign runs in CI as MIRRORGRID's **own reliability regression suite** — the
  project tests itself with the tool it is.

**Gate — `npm run verify:campaign`**
1. All ten experiments run headless and produce reports with measured MTTD/MTTR/blast radius/SLO.
2. Every world-plane experiment is byte-reproducible across two runs.
3. The benchmark ladder completes and `docs/benchmarks/baseline.md` is regenerated from real output.
4. The security suite passes with zero high findings; `gitleaks` and image scan clean.
5. CI runs the campaign on a schedule and publishes results as artifacts.

---

## Sequencing and relative effort

Ordering is driven by three dependencies: determinism must precede anything that replays or compares;
the runtime port must precede both adapters; observability must precede root-cause analysis.

| # | Milestone | Weight | Why this position |
|---|---|---|---|
| M0 | Foundation + skeleton | M | Nothing ships without CI and a real API |
| M1 | Domain + topology | M | Edge policies are M2's input |
| M2 | **Deterministic logical runtime** | **XL** | Everything downstream depends on it; unretrofittable |
| M3 | **Container runtime peer** | **XL** | Your peer-runtime decision; gated by the conformance suite |
| M4 | Reliability + fault engine | L | Needs a runtime to run in |
| M5 | Experiment engine + flagship | L | **First demoable artifact — the portfolio centrepiece** |
| M6 | Security | M | Must precede exposing chaos execution |
| M7 | Jobs, leases, Redis | L | Platform-plane distribution begins |
| M8 | Outbox, Kafka, CQRS, NATS, WS | **XL** | The heaviest platform milestone |
| M9 | Observability | L | Prerequisite for M10's RCA |
| M10 | Reliability engine + reports | L | Turns runs into verdicts |
| M11 | Snapshot, replay, search, DR | L | Cashes in M2's determinism |
| M12 | Containers, k8s, HA | L | Historically the stall point — gate is concrete |
| M13 | Perf, hardening, campaign | M | Produces the evidence artifacts |

### Three tiers, with M5 as a hard release boundary

```
M0 ─ M5    ⭐ MIRRORGRID v0.1 — the shippable core
M6 ─ M10      Hardened platform
M11 ─ M13     Research / production-grade layer
```

**M5 is a release, not a checkpoint.** Tag `v0.1`, write the README from the gate output, record the
demo. At that point MIRRORGRID already stands on its own:

```
REAL API · REAL UI · REAL WORLD · REAL SIMULATION
REAL FAULT · REAL PROPAGATION · REAL RECOVERY · REPLAYABLE LOGICAL RUN
```

**Do not cross M5 until the core genuinely works.** Every sibling project's failure was crossing a
boundary like this one with the previous tier still hollow — infrasight moved to polish with the
backend unwired; ApexPerf shipped a Helm chart over an empty `packages/`. If time runs short later,
stopping cleanly after M10 is a far stronger portfolio piece than reaching M13 with thin modules.

**Explicitly out of scope** (§135) — understanding these is demonstrated by *not* rebuilding them:
custom Kafka, custom scheduler, custom database engine, service mesh, multi-region deployment,
consensus algorithm, cloud control plane.

---

## UI delivery map

The 85-section UI spec is delivered alongside its backing API, never ahead of it (the no-mock rule).
Screens map to milestones as follows:

| Milestone | Screens (spec §) |
|---|---|
| M0 | App shell §7–10, system status §12, dashboard §13–14, worlds list §15, create world §16 |
| M1 | World header §17, overview §18, topology §19–22, service drawer §23, service page §24–26 |
| M2 | Live metrics on world overview; metric cards §14 fed by real sim output |
| M3 | Runtime-mode selector; capability disclosure; instance view §26 |
| M5 | Experiments list §27, builder wizard §28, **live experiment §29–31**, result §32–33 |
| M6 | Settings §51, API keys §52, security §53, audit §50 |
| M7 | Workers §44, queue inspector §45, DLQ |
| M8 | Events §36, event drawer §37, realtime everywhere, degraded banners §58 |
| M9 | Metrics §39/§94, traces §38/§92, incident timeline §132 |
| M10 | Reliability §40/§95, SLO detail §41, failure analysis §34, incident §35, blast radius §75, root cause §76, scorecard §77 |
| M11 | Snapshots §46–47, replay §48–49, global search §11/§96 |
| M12 | System health §79, architecture map §78 |
| Throughout | Command palette §60, shortcuts §61, empty §55 / loading §56 / error §57 states, toasts §66, danger confirmations §59 |

**Cross-cutting UI rules** applied from M0 rather than retrofitted:
- Progressive disclosure (§70): the surface answers *what broke / why / impact / did it recover*;
  pods, partitions, offsets and pool stats live behind **Technical Details**.
- Drawer for inspection, page for workspace (§69).
- Error states name the failing component and carry a `requestId` (§57) — never "Something went wrong".
- Degraded states are distinct from failed states (§58, §79) — this is where §76's telemetry-degraded
  signal surfaces.
- Server components for world metadata, reports and snapshots; client components only for topology,
  live metrics, charts and experiment controls (§107).

---

## Verification

**Per-milestone.** Every `verify:*` gate above is a real npm script under `tests/`, runnable locally
and in CI. The plan is complete when all fourteen pass on a clean checkout.

### CI is split in two — fast on PRs, heavy on a schedule

Running the full campaign on every pull request would put a 5,000 req/s benchmark, a Kafka outage, a
kind cluster and a Postgres restore between you and every commit. The feedback loop has to stay
minutes, not tens of minutes.

| **PR suite** (every push, target < 8 min) | **Nightly suite** (scheduled + manual) |
|---|---|
| typecheck, lint, dependency-cruiser | full chaos campaign (all ten experiments) |
| unit tests | benchmark ladder to 5,000 req/s |
| integration (testcontainers) | Kubernetes HA + rolling deploy |
| contract (OpenAPI drift, runtime conformance) | DR drill: backup → destroy → restore → replay |
| gitleaks, no-mock-data assertion | long-running replay divergence corpus |
| **deterministic smoke replay** (~30 short fixture runs) | image scanning, full security suite |

The deterministic smoke replay is the one heavy-ish check that stays on PRs, because determinism is
the property most likely to be broken silently by an unrelated change and the cheapest to catch
early. Nightly failures open an issue; PR failures block the merge.

**Running the stack locally**

```bash
docker desktop start
docker compose -f infrastructure/compose/docker-compose.yml up -d
npm run db:migrate
npm run dev                # turbo: all apps + web
```

**The end-to-end demo** (§139 — the workflow that demonstrates the whole project):

```bash
npm run demo:flagship
```

Creates a World, defines services and dependencies, generates 500 req/s, establishes a baseline,
injects Payments latency, observes propagation and retry amplification, watches the circuit open,
removes the fault, measures MTTR, verifies SLO, snapshots, replays the event stream, compares state
and generates the report — printing measured numbers at each step.

**Definition of done** (§141) — not "all technologies are connected", but:

```
A failure can be introduced.        ✓ M4 fault engine
Its propagation can be explained.   ✓ M10 root-cause + blast radius
Its impact can be measured.         ✓ M2 metrics + M10 SLO
Its mitigation can be verified.     ✓ M4 reliability library
The system can recover.             ✓ M5 recovery phases
The state can be reconstructed.     ✓ M11 snapshot + replay
The experiment can be replayed.     ✓ M2 determinism
The result can be reproduced.       ✓ verify:flagship gate 6
```

---
