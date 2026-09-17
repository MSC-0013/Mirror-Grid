# MIRRORGRID — Remediation Implementation Guide

> **Working document.** One section per phase, in dependency order. Each phase states what to
> build, the exact files, the gate that proves it, and the mistakes it invites.
> Tick items off as they land. Status here is only ever updated from a gate that actually ran.

**Last verified:** 2026-09-16 · commit `d86a26d` + uncommitted R1 work

---

## Why this document exists

M00–M13 are structurally complete: 17 commits, ~30,000 lines, 18 packages, 14 gates, 41/41
typecheck. M0, M1 and M2 are genuinely done — `verify:determinism` passes 8/8 with FastDriver and
RealtimeDriver producing identical state hashes, which is a hard property to earn and was earned.

But four milestones kept their names while their substance became in-process models:

| Milestone | Claimed | Actually |
|---|---|---|
| M12 | Kubernetes HA certification | `namespace-manager.ts` is a `Map<string, ManagedPod[]>`. No kubectl, no kind, no `deploy/` |
| M3 | Container runtime peer | Zero `dockerode` references. The conformance suite compares two in-process models |
| M7 | Distributed leases, no races | `FOR UPDATE SKIP LOCKED` appears nowhere; SQLite WAL has one writer, so the gate passes for the wrong reason |
| M8 | Outbox + Kafka | Commit message says "in-process journal". No Kafka client, no NATS |

Plus `LoadRunner` defaults its workload to `async () => true`, so "754,609 req/s" measures V8 promise
overhead, not MIRRORGRID.

**R0–R7 close the distance between what the code does and what the docs say it does.** Nothing is
thrown away — the manifest compiler, conformance harness, campaign executor and SRE engine all
survive. They get pointed at reality instead of at a model.

---

## Phase order

```
R0 ──► R1 ──► R2 ──┐
                   ├──► R5 ──► R6
       R0 ──► R4 ──┘
       R1 ──► R3 ──────────────┘
R7 runs continuously alongside all of them.
```

| Phase | What | Status |
|---|---|---|
| R0 | Docker + kind actually working | ⬜ **Blocked — daemon not running** |
| R1 | MySQL 8.4 as the single database | ✅ **Code complete — 41/41 typecheck; DB-touching gates unverified (R0 blocked)** |
| R2 | M7: real lease protocol | ⬜ |
| R3 | M8: real Kafka + NATS | ⬜ |
| R4 | M3: real containers | ⬜ |
| R5 | M12: real Kubernetes | ⬜ |
| R6 | M13: benchmark that measures something | ⬜ |
| R7 | Claims reconciliation | ⬜ |

---

# R0 — Make the environment real

**Do this first.** Docker Desktop is installed but has not been running in any session checked, and
`settings-store.json` has `"AutoStart": false`. That is almost certainly *why* the in-process
substitutions exist — faced with a dead daemon, a `Map` of pods is the path of least resistance.
Attempting R4/R5 against a dead daemon reproduces the same outcome.

- [ ] Start Docker Desktop; consider enabling autostart
- [ ] `docker info` returns a server version, not a named-pipe error
- [ ] `C:\Users\HP\.wslconfig` already exists (`memory=10GB`, `processors=8`, `swap=4GB`) — run
      `wsl --shutdown` once so it takes effect, then confirm via `docker info`
- [ ] Pull images: `mysql:8.4`, `redis:7.4.2-alpine`, `ghcr.io/shopify/toxiproxy`, Kafka, `nats:alpine`
- [ ] `kind create cluster --name mg-test && kubectl get nodes && kind delete cluster --name mg-test`
- [ ] Write `docs/adr/007-local-runtime-environment.md` recording measured memory and disk headroom

**Gate:** `docker info` succeeds · a throwaway kind cluster creates, reports a Ready node, deletes ·
`docker compose --profile core up -d` brings MySQL healthy.

**If kind genuinely cannot run here**, that is a legitimate finding. Record it in the ADR and scope
R5 down to "manifest compiler + OpenAPI validation, applied to a cluster in CI only". That is
honest and defensible. A `Map` named `NamespaceManager` claiming pod-eviction certification is not.

---

# R1 — MySQL 8.4 as the single database

SQLite (commit `9653760`) reversed the original PostgreSQL decision with no ADR, and cost the one
thing M7 needs: `SELECT … FOR UPDATE SKIP LOCKED`. MySQL 8.0+ has it.

## Done

- [x] `docker-compose.yml` — `mysql:8.4` added (healthcheck, `mem_limit: 512m`,
      `innodb-buffer-pool-size=256M`, `core`/`full` profiles); `postgres` service removed;
      volume `postgres_data` → `mysql_data`
- [x] `packages/db/package.json` — `@libsql/client` removed, `mysql2@^3.24.4` added
- [x] `packages/db/src/client.ts` — `drizzle-orm/mysql2` pool; `parseDatabaseUrl()` replaces
      `resolveDatabaseUrl()`; `multipleStatements`, `timezone: 'Z'`, `supportBigNumbers`
- [x] `packages/db/src/migrate.ts` — bootstraps the database, MySQL `_migrations` ledger,
      fails loudly on partial application (MySQL DDL is not transactional)
- [x] `packages/db/src/health.ts` — `queryClient.query('SELECT 1')`
- [x] **All 14 migrations** converted: `BLOB`→`BIGINT UNSIGNED`, `INTEGER`(`*_at`)→`DATETIME(3)`,
      `TEXT`→`VARCHAR(36|64|255)`/`TEXT`, `AUTOINCREMENT`→`AUTO_INCREMENT`,
      `NUMERIC`→`DECIMAL(18,6)`, `REAL`→`DOUBLE`, InnoDB/utf8mb4 table options
- [x] **The one partial index** → stored generated column:
      `is_error TINYINT(1) AS (status_code = 'ERROR') STORED` + `INDEX (world_id, is_error)`
- [x] **All 15 Drizzle schema files** → `mysql-core`. Timestamps use
      `datetime({ mode: 'date', fsp: 3 })` so the TypeScript surface stays `Date` — changing it to
      `number` would ripple through every call site
- [x] `.env`, `.env.example`, `packages/config/src/env.ts` → `mysql://…`
- [x] `packages/db/src/returning.ts` — `insertReturning` / `insertManyReturning` /
      `updateReturning` / `deleteReturning`, because **MySQL has no `RETURNING`**
- [x] `packages/db` typechecks clean

## Done — 45 call sites, all four known kinds

`packages/db` plus every app-code call site. `npx turbo run typecheck` → **41/41 tasks**.

| Kind | Count | Fix applied |
|---|---|---|
| `.returning()` | **41** | Helpers from `@mirrorgrid/db`, or hand-written where the generic helper would be wrong (below) |
| `.onConflictDoUpdate()` | **3** | → `.onDuplicateKeyUpdate({ set: {…} })` |
| `db.run(sql\`…\`)` | **1** | → `db.execute(sql\`…\`)` |

**Files:**

- [x] `packages/jobs/src/core/lease-manager.ts` — 4
- [x] `apps/control/src/modules/runtime/runtime.repository.ts` — 4
- [x] `apps/control/src/modules/faults/fault.repository.ts` — 4
- [x] `apps/control/src/modules/experiments/experiment.repository.ts` — 4
- [x] `apps/control/src/modules/auth/auth.repository.ts` — 4
- [x] `apps/control/src/modules/worlds/worlds.repository.ts` — 3
- [x] `apps/control/src/modules/workloads/workloads.repository.ts` — 3
- [x] `apps/control/src/modules/services/services.repository.ts` — 3
- [x] `apps/control/src/modules/dependencies/dependencies.repository.ts` — 3
- [x] `apps/control/src/modules/breakers/breaker.repository.ts` — 3
- [x] `apps/simulation/src/modules/simulation/simulation.repository.ts` — 2
- [x] `apps/control/src/modules/sre/slo.routes.ts` — 2
- [x] `apps/control/src/modules/sre/rca.routes.ts` — 2
- [x] `packages/security/src/auth/session-store.ts` — 1
- [x] `packages/security/src/audit/audit-logger.ts` — 1
- [x] `packages/events/src/cqrs/activity-projector.ts` — 1 (`onConflictDoUpdate`)
- [x] `packages/events/src/consumer/idempotent-consumer.ts` — 1 (`db.run`)

### Four call sites the generic helpers would have gotten wrong

The mechanical `insertReturning`/`updateReturning`/`deleteReturning` conversion covered most sites,
but four needed hand-written replacements because the generic pattern would silently have
introduced a bug:

1. **`lease-manager.ts` `claimJob`** — the UPDATE's `WHERE` clause (`status = 'PENDING' OR
   lease-expired`) is the race guard against double-claiming a job. `updateReturning()` selects an
   id first and then updates *by id alone*, which would drop that guard between the two steps and
   reopen the exact race it exists to prevent. Written instead as an UPDATE with the full guard in
   its `WHERE`, checking `affectedRows`, and only then re-selecting by id.
2. **`services.repository.ts` `create`** — runs inside `db.transaction(async (tx) => …)` alongside
   a second insert (service instances) that must commit atomically with it. The generic helpers
   always read back through the pool-level `db`, a different connection than `tx` — inside a
   transaction that would either see nothing (uncommitted) or break atomicity. Written inline
   against `tx` directly.
3. **`fault.repository.ts` `abortAllActiveExecutions`** — aborts and returns *all* active faults for
   a world, an inherently multi-row operation the single-row helpers don't model. Captures the
   target ids before the update, updates guarded by the same `WHERE`, re-selects by
   `inArray(id, ids)`.
4. **`breaker.repository.ts` `upsertBreakerState`** and **`runtime.repository.ts`
   `recordContainerInstance`** — true upserts (`INSERT … ON DUPLICATE KEY UPDATE`), which neither
   helper covers. Written as insert-with-upsert followed by a re-select on the natural key
   (verified against each table's `unique(...)` constraint). The breaker case additionally needed
   `isNull(edgeId)` rather than `eq(edgeId, null)` for its nullable key column — `eq()` against
   `null` compiles to `= NULL`, which SQL always evaluates as unknown, never true.

### Conversion recipes

```ts
// INSERT ────────────────────────────────────────────────────────────────
const [row] = await db.insert(worlds).values(v).returning();
const row = await insertReturning(worlds, v);

// UPDATE ────────────────────────────────────────────────────────────────
const [updated] = await db.update(services).set(v).where(w).returning();
const updated = await updateReturning(services, v, w);

// DELETE ────────────────────────────────────────────────────────────────
const [deleted] = await db.delete(services).where(w).returning();
const deleted = await deleteReturning(services, w);

// UPSERT ────────────────────────────────────────────────────────────────
await db.insert(t).values(v).onConflictDoUpdate({ target: t.id, set: s });
await db.insert(t).values(v).onDuplicateKeyUpdate({ set: s });

// RAW ───────────────────────────────────────────────────────────────────
await db.run(sql`…`);
await db.execute(sql`…`);
```

**Watch the null contract.** `.returning()` yielded `[]` (so `const [x] =` gave `undefined`);
`updateReturning`/`deleteReturning` return `null`. Call sites doing `return updated || null` are
already correct; ones doing `return updated[0]` are not.

**One real cost:** each helper is a write plus a read — an extra round trip, and **not atomic**
unless wrapped in `db.transaction(...)`. Fine for read-your-own-write inside a request. Wrap the
pair anywhere a concurrent writer could interleave.

## Verification

**Done, offline (no Docker needed):**

- [x] `npx turbo run typecheck` → **41/41 tasks successful**
- [x] `npm run verify:determinism` → **8/8**, hashes unchanged
      (`7a653d0704a62888db34818a3fb335d4e6354076621cda72cf5841c9c8392398`) — proves the app-code
      conversion touched nothing the pure engine depends on
- [x] Final sweep — `grep -rin "libsql\|sqlite" apps packages infrastructure` (excluding
      `node_modules`, `dist`, `.next`) returns only one accurate comment in `returning.ts`
      documenting that Postgres/SQLite have `RETURNING` and MySQL doesn't

**Blocked on R0 (Docker not running in this session):**

```bash
docker compose -f infrastructure/compose/docker-compose.yml --profile core up -d
npm run db:migrate      # clean DB: all 14 should apply
npm run db:migrate      # re-run: all 14 should skip
```

Then every DB-touching gate: `verify:m0`, `:m1`, `:m4`, `:flagship`, `:m6`, `:events`,
`:recovery`, `:reliability`.

- **Expect `verify:concurrency` to behave differently.** It passes today because SQLite serialises
  writers. On MySQL, with row locking and no `SKIP LOCKED` yet, it may deadlock or pass for a new
  wrong reason. **That is the expected outcome, not a regression** — R2 replaces both the query and
  the gate.

## Pitfalls

- Column names with digits (`p99_latency_ms`) — any regex using `[a-z_]+` silently skips them.
  Use `[a-z0-9_]+`. This bit once already.
- `.primaryKey({ autoIncrement: true })` is SQLite. MySQL: `.autoincrement().primaryKey()`.
- utf8mb4 `VARCHAR(255)` costs 1020 index bytes. Keys are `VARCHAR(36)`, hashes `VARCHAR(64)`.
  A three-column unique on 255-char columns would exceed the 3072-byte limit.
- MySQL DDL is **not transactional**. A migration that fails halfway leaves partial state — drop
  and recreate rather than re-running.

---

# R2 — M7: make the lease protocol real

**Why:** the payoff for R1. Today's gate cannot fail.

- [ ] `packages/jobs/src/core/lease-manager.ts` — the claim query below
- [ ] `packages/jobs/src/core/lease-sweeper.ts` — returns expired leases to `READY`, running
      independently of any worker (a crashed worker's job must still be reclaimable)
- [ ] `tests/gates/verify-concurrency.ts` — rewritten so it can fail

```sql
-- MySQL cannot SELECT directly from the table being updated; the derived table is required.
UPDATE jobs SET status = 'CLAIMED', worker_id = ?,
       lease_until = NOW(6) + INTERVAL 30 SECOND, attempt_count = attempt_count + 1
WHERE id = (SELECT id FROM (
              SELECT id FROM jobs
              WHERE status = 'READY' AND next_attempt_at <= NOW(6)
              ORDER BY priority DESC, next_attempt_at
              FOR UPDATE SKIP LOCKED LIMIT 1) AS t);
```

**Gate:**
1. **8 worker processes** — not 8 promises — claim from 1,000 jobs; each job produces **exactly one
   committed effect**. In-process concurrency against one writer proves nothing; separate processes
   are the entire point.
2. `SIGKILL` a worker holding a lease → another reclaims after expiry and completes it.
3. **Kill between effect and ack** → the effect is not duplicated, because the operation is
   idempotent. This is what distinguishes exactly-once *effect* from exactly-once *execution*.
4. Two simultaneous experiment starts → one transitions, the other is idempotent-rejected.

**Language fix:** stop claiming "mutual exclusion" and "no race conditions". Claim
**at-least-once delivery + idempotent processing = exactly-once effect** — true, and the more
sophisticated statement.

---

# R3 — M8: real Kafka and NATS

- [ ] `packages/events` — add **`@confluentinc/kafka-javascript@1.10.1`**, *not* `kafkajs`
      (last published 2023-02-27, ~3.5 years stale; an unmaintained broker client is exactly what
      gets probed in an interview)
- [ ] `outbox-publisher.ts` — poll → publish → mark published, with retry and `attempt_count`
- [ ] Outbox poll index — no partial indexes in MySQL, so reuse R1's pattern:
      `is_pending TINYINT(1) AS (status = 'PENDING') STORED` + `INDEX (is_pending, next_attempt_at)`
- [ ] `packages/messaging` — NATS JetStream (`nats@2.29.3`); command state is three-valued:
      `DISPATCHED` / `EXECUTED` / `FAILED`. **A JetStream ack means the broker persisted the
      message, not that the command ran.**
- [ ] compose — add `nats:jetstream`; Kafka is already defined
- [ ] `docs/events/delivery-semantics.md` — per-topic guarantees, declared not assumed:
      domain/audit/experiments at-least-once, telemetry at-most-once, commands + execution ack

**Gate:** one outbox row per committed domain change in the same transaction ·
**`docker stop kafka` → writes still succeed, outbox grows, UI degrades; restart drains with zero
loss and per-world ordering preserved** · duplicate delivery leaves the projection unchanged ·
consumer killed mid-batch → no sequence gap after rebalance.

That middle assertion cannot be faked by an in-process journal. It is the real test.

---

# R4 — M3: real containers

`apps/synthetic-service/Dockerfile` already exists; nothing drives it.

- [ ] `apps/runtime-agent` — **`dockerode@5.0.1`**: create, start, kill, restart, `update` for
      CPU/memory
- [ ] `toxiproxy-client.ts` — real Toxiproxy HTTP API, **one proxy per dependency edge**
- [ ] `packages/container-runtime` — `ContainerRuntimeAdapter` driving the agent over gRPC
- [ ] `proto/runtime.proto`
- [ ] `tests/contract/runtime-adapter.conformance.ts` — same suite, both adapters, now meaningful

**Why per-edge proxies, not per-service:** it buys the whole network-fault family with no
`NET_ADMIN`; makes asymmetric partitions expressible (`A→B` and `B→A` are separate proxies); and
lets `DATABASE_UNAVAILABLE` be scoped to one consumer — disable `orders→mysql`, leave
`payments→mysql` healthy. Per-service proxying expresses none of that.

**Gate:**
1. Conformance suite passes against **both** adapters.
2. Six real containers serve 500 req/s over real HTTP; P95 recorded.
3. Latency toxic on `orders→payments`, as **two separate claims** — the old single assertion was
   unsound: **(a)** measured **edge-span** duration rises by the injected amount ±10%;
   **(b)** end-to-end P95 increased **directionally**, with no claim it equals baseline + injected.
   Queueing, retries and saturation reshape the aggregate, so it can legitimately move much more.
4. `SERVICE_CRASH` → `docker kill` → exits, health `FAILED`, restart → `HEALTHY`.
5. **Real `CPU_PRESSURE` via cgroup quota and a real OOM kill (exit 137)** — the things LOGICAL can
   only model, and the entire justification for CONTAINER mode existing.
6. `docker stats` stays inside the memory budget.

`REAL_PACKET_LOSS` (netem sidecar, `NET_ADMIN`) stays opt-in; **the gate must pass without it.**

**Pitfall:** `reset_peer` toxicity is evaluated **per connection**, so with keep-alive the observed
per-request error rate oscillates and will not equal the configured toxicity. Set
`keep_alive: false` on the edge when a stable rate is needed.

---

# R5 — M12: real Kubernetes

Keep the manifest compiler — it is genuine work. Replace the `Map`.

- [ ] **`deploy/kind/`** — does not exist today. Cluster config, namespace, ConfigMaps, Secrets,
      Deployments, Services, Ingress, **HPA, PDB, NetworkPolicy**
- [ ] `packages/k8s/src/client/` — **`@kubernetes/client-node@2.0.0`** against kind, replacing
      `NamespaceManager`
- [ ] Graceful shutdown in every service: SIGTERM → stop accepting → drain → stop job claims →
      flush telemetry → close pools → exit

**Networking:** kind runs **only stateless application services**. MySQL, Redis, Kafka and NATS stay
in Compose on the host, reached via one `ExternalName` Service pointing at `host.docker.internal`,
resolved once in a ConfigMap. Duplicating the data stack inside kind roughly doubles memory for no
added insight — this milestone tests *application* HA.

**Gate — an SLO, not an absolute:**
1. **Real `kubectl delete pod`** on a gateway replica under 500 req/s of **real traffic**:
   error rate < 0.1%, zero 5xx on established idempotent requests, recovery < 10s, values printed.
   *Not "0 drops, 100% availability" — that is either untrue or a hand-tuned harness.*
2. Real rolling deployment under load → no dropped connections.
3. Kill a worker pod mid-job → lease reclaim via R2's protocol, no duplicate effect.
4. NetworkPolicy: `web→control` blocked, `gateway→control` allowed.
5. SIGTERM → clean exit within grace period.

---

# R6 — M13: a benchmark that measures the platform

`LoadRunner.execute` defaults `workloadFn` to `async () => true`, and `campaign/` makes **zero
network calls**.

- [ ] `tests/load/` — real HTTP against the running gateway via **`autocannon@8.0.0`**
- [ ] Ladder: 100 / 500 / 1k / 2.5k / 5k req/s → P50/P90/P95/P99/P99.9, throughput, errors, CPU,
      memory, DB latency, queue depth, Kafka lag
- [ ] Baseline-then-one-change: `EXPLAIN` on the top five queries, one index at a time, recorded
- [ ] Platform-plane scenarios become real: 005 stops Kafka, 006 kills a worker, 007 stops Redis

**Campaign split:** 7 world-plane (001–004, **008–010**) + 3 platform-plane (005–007). World-plane
is not a contiguous range — reading "001–004 are world-plane" as exhaustive misclassifies the last
three.

**Expect the honest number to be orders of magnitude lower, and say so.** A truthful 2,000 req/s
with a defensible P99 is worth more than 754,000 req/s that measures promise overhead. Drop the
`>= 10k req/s` target or re-derive it from what the stack actually sustains.

---

# R7 — Claims reconciliation *(continuous)*

- [ ] Remove "GA v1.0", "Production Release Certification", "certified green" — unearned until
      R1–R6 are green
- [ ] Delete MTTD **0.00s**, RTO **1ms**, "100% availability", "20/20 100%", "1.397M req/s".
      Real systems do not produce round numbers under adversarial conditions; these read as
      fabricated even where the code behind them is real
- [ ] Status tables generated from gate output. Any milestone whose gate is rewritten in R2–R6
      reverts to IN PROGRESS until the new gate passes
- [ ] `docs/adr/006-mysql-single-database.md` — the ADR the SQLite migration never got
- [ ] `docs/adr/007-local-runtime-environment.md` — from R0
- [ ] README states plainly what is **verified** and what is **modelled**

**Correct three milestone docs that specify the wrong thing:**

| Doc | Correction |
|---|---|
| M02 §5 | DDL is PostgreSQL → MySQL 8.4, incl. no partial indexes |
| M03 §12 | Aggregate-P95 assertion is unsound → split into edge-span (exact) + end-to-end (directional) |
| M12 §12 | "Zero failed requests" → SLO: <0.1% errors, no 5xx on idempotent requests, <10s recovery |

**The standard:** every claim traceable to a gate assertion that could fail.
*"Zero-Docker Kubernetes HA certification"* is the most interview-fragile sentence in the repo —
one question about how pod eviction was tested ends the conversation. Delete it before it is read.

---

## The bar every rewritten gate must clear

`verify:determinism` is the template, and the one gate here that is beyond reproach:

```
[7/8] Verifying Driver Equivalence (FastDriver hash == RealtimeDriver hash)...
  FastDriver Hash:     7a653d0704a62888db34818a3fb335d4e6354076621cda72cf5841c9c8392398
  RealtimeDriver Hash: 7a653d0704a62888db34818a3fb335d4e6354076621cda72cf5841c9c8392398
  PASS: Driver Equivalence proven (zero wall-clock leak into model state).
```

It prints the values it compared, it fails for real reasons, and it would catch the author being
wrong. **A gate that cannot fail is documentation, not verification.**

## If time runs short

Stop after **R4**. A proven deterministic engine, a real MySQL lease protocol, and a real container
runtime — with M12 honestly labelled a manifest compiler — is a far stronger portfolio artifact than
claiming Kubernetes certification from a hash map. The honest version is also *more* impressive,
because every number in it can be reproduced by someone who doubts it.
