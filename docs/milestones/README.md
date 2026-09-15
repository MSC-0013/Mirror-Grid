# MIRRORGRID — Milestone Documentation Index

> **These documents are the execution layer of the implementation plan.**
> The strategy lives in `docs/IMPLEMENTATION_PLAN.md`; these docs are the how.
> Each doc is a self-contained build spec for one milestone, written before work begins so it can be reviewed.

---

## Reading Order

Production order differs from numeric order because shared contracts must stabilize before they are referenced:

```
README → M00 → M01 → M02 → M04 → M03 → M05 → M06 → M07 → M08
       → M09 → M10 → M11 → M12 → M13
```

M04 precedes M03 because the container runtime consumes the reliability primitives' core/shell
contract. M02 precedes M04 because both adapters implement the `RuntimeAdapter` port defined in M01
and realized in M02.

---

## Status Table

> **This table is generated from CI gate results — never hand-edited.**
> A milestone is DONE when its `npm run verify:*` gate runs green in CI, not when its files exist.

| # | Milestone | Gate | Status | CI Run |
|---|---|---|---|---|
| M0 | Foundation + walking skeleton | `verify:m0` | NOT STARTED | — |
| M1 | Domain model + topology | `verify:m1` | NOT STARTED | — |
| M2 | Deterministic logical runtime | `verify:determinism` | NOT STARTED | — |
| M3 | Container runtime peer | `verify:m3` | NOT STARTED | — |
| M4 | Reliability + fault engine | `verify:m4` | NOT STARTED | — |
| M5 | Experiment engine + flagship | `verify:flagship` | NOT STARTED | — |
| M6 | Security: RBAC, audit, rate limiting | `verify:m6` | NOT STARTED | — |
| M7 | Async platform: jobs, leases, DLQ | `verify:concurrency` | NOT STARTED | — |
| M8 | Event platform: outbox, Kafka, CQRS | `verify:events` | NOT STARTED | — |
| M9 | Observability | `verify:observability` | NOT STARTED | — |
| M10 | Reliability engine: SLO, RCA, reports | `verify:reliability` | NOT STARTED | — |
| M11 | Snapshot, replay, search, DR | `verify:recovery` | NOT STARTED | — |
| M12 | Containers, Kubernetes, HA | `verify:ha` | NOT STARTED | — |
| M13 | Performance, hardening, campaign | `verify:campaign` | NOT STARTED | — |

---

## Three Tiers

```
M0 - M5    MIRRORGRID v0.1 — the shippable core
M6 - M10   Hardened platform
M11 - M13  Research / production-grade layer
```

**M5 is a release, not a checkpoint.** Tag `v0.1`, write the README from the gate output, record the
demo. Do not cross M5 until the core genuinely works.

---

## Conventions (shared by all docs)

### File naming
- kebab-case filenames throughout
- Backend: explicit `.js` import extensions
- Migrations: `0NN_*.sql` numbered (Drizzle + hand-written SQL)
- Module shape: `<name>.routes.ts / .controller.ts / .service.ts / .repository.ts / .schema.ts + index.ts`

### TypeScript
- `strict: true`, `NodeNext` module resolution, `noUnusedLocals: true`, `noUnusedParameters: true`
- `packages/sim` and `packages/reliability` have zero runtime dependencies (CI-enforced)
- `Date.now()` and `Math.random()` banned inside `packages/sim` (ESLint no-restricted-globals)

### API
- Routes under `/api/v1`; `/health` outside the prefix
- zod schemas via `fastify-type-provider-zod@7` => OpenAPI 3.1 at `/openapi.json`
- Frontend types generated from that spec (never from mock data)
- Error envelope: `{ code, message, requestId }` — no SQL, no stack traces, no hostnames

### The No-Mock Rule
**There is no `mock-data.ts` in this repo, ever.** A screen is not built until its endpoint exists.
A grep test in CI fails the build if `mock-data.ts` appears anywhere.

### Cross-document linking
A decision is argued in exactly one doc and *linked* from the others.
- Determinism contract -> M02
- Core/shell split -> M04
- RuntimeAdapter port -> M01
- Per-world event sequencing -> M08
- Health semantics -> M00

### Section marked "None — and why"
Where a section does not apply to a milestone, it says **"None — and why"** rather than being dropped.

---

## Template (14 sections, every milestone doc)

```
 1. Context          Why this milestone exists; what breaks without it
 2. Prerequisites    Which milestones must be green; which compose profile to start
 3. Scope            In scope / explicitly out of scope
 4. Design           The decisions that matter, with rationale and rejected alternatives
 5. Data model       Full DDL for this milestone's migration, with index rationale
 6. Packages         Every file to create, by path, with its responsibility
 7. Interfaces       Real TypeScript signatures for the contracts other milestones consume
 8. API              Endpoints with zod schemas -> the OpenAPI they generate
 9. UI               Screens, mapped to spec section numbers, with layout notes
10. Steps            Ordered implementation sequence, each step independently committable
11. Testing          Unit / integration / contract / e2e, with what each actually asserts
12. Gate             The exact `npm run verify:*` command and every assertion it makes
13. Pitfalls         The specific mistakes this milestone invites
14. Done             Checklist — every item objectively checkable, none self-certified
```
