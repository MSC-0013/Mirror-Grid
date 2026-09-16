# ADR 003: State Machines as Data and Application-Enforced State Transitions

## Status

Accepted

## Context

In distributed systems reliability engineering, state transitions for long-running entities (such as `WorldStatus` and `ServiceStatus`) must adhere strictly to valid operational lifecycles. For instance, a World transitioning from `COMPLETED` directly back to `RUNNING` represents invalid logic that breaks deterministic event replay and lifecycle guarantees.

Common alternatives in relational databases include using native PostgreSQL `ENUM` types or database triggers. However:

1. Native PostgreSQL `ENUM` types cannot enforce valid directional transitions between states; they only constrain a column value to a set of strings.
2. Modifying or expanding Postgres `ENUM` types requires database DDL migrations (`ALTER TYPE ... ADD VALUE`), which cannot run cleanly within transaction blocks in earlier PostgreSQL versions and increases operational friction.
3. Database triggers split domain logic across application code and PL/pgSQL, making state machines harder to unit test deterministically without spinning up a live database.

## Decision

We enforce state machines as **data structures and pure transition tables** in `@mirrorgrid/domain`, backed by check constraints at the storage layer:

1. State columns (`status` on `worlds`, `services`, `service_instances`) are typed as `TEXT` with strict SQL `CHECK (status IN (...))` constraints preventing invalid string values.
2. Valid directional transitions are defined as immutable transition tables in `@mirrorgrid/domain`:
   - `WorldStatus`: `IDLE`, `CONFIGURING`, `READY`, `RUNNING`, `PAUSED`, `STOPPING`, `STOPPED`, `FAILED`, `ARCHIVED`
   - `ServiceStatus`: `STOPPED`, `STARTING`, `HEALTHY`, `DEGRADED`, `PARTIALLY_AVAILABLE`, `UNHEALTHY`, `FAILED`, `UNKNOWN`
3. Application services validate every transition using pure helper functions:
   - `isValidWorldTransition(from, to)`
   - `isValidServiceTransition(from, to)`
     Illegal transitions are rejected at the API boundary with a descriptive `400 Bad Request` or `422 Unprocessable Entity` containing the allowed next states.
4. Graph structures and acyclic invariants (DAG) are verified at write time (`POST /dependencies`) via 3-color DFS cycle detection in `packages/domain/src/graph/algorithms.ts`.

## Consequences

### Positive

- Domain lifecycle logic is 100% pure TypeScript and unit-testable in microseconds with zero I/O dependencies.
- Adding a new status or valid transition requires no schema migrations, only code updates.
- Clear, actionable HTTP error messages inform callers of exactly which transitions are permitted from the entity's current state.

### Negative

- Direct manual SQL updates bypassing the application layer must respect the column `CHECK` constraint, but could theoretically execute an illegal transition if done directly in psql. This is acceptable as direct DB writes are prohibited in production operation.
