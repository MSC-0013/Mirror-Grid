# ADR 005: Virtual Clock Total Ordering and Driver Equivalence

## Status

Accepted

## Context

MIRRORGRID requires two distinct modes of advancing simulated time:

1. **Interactive Realtime Mode:** Paces execution to 1× wall clock for live browser visualization and human observation of telemetry cards.
2. **Batch / Fast Mode:** Drains the event heap as fast as CPU instructions allow for instant CI test verification, large-scale benchmarks, and event stream replay.

If wall-clock time is permitted to influence model state, branch conditions, or event ordering, the fast driver and realtime driver will yield different states and diverging hashes.

## Decision

We decouple model time from execution pacing using a Virtual Clock with two interchangeable drivers:

1. **Total Ordering Invariant:**

   - The event heap (`EventHeap`) is a binary min-heap ordered strictly by a 3-tuple:
     $$(t, \text{priority}, \text{seq})$$
   - `t`: Integer microsecond virtual timestamp.
   - `priority`: Numeric priority tier (e.g., fault arrival > request arrival > departure > telemetry flush).
   - `seq`: Monotonically increasing 64-bit integer assigned at event insertion.
   - This ensures simultaneous events never suffer ambiguous or non-deterministic ordering.

2. **Strict Authority of Virtual Time:**

   - Model state and service models query only `virtualClock.nowUs()`.
   - `Date.now()` and system timers are completely banned from `packages/sim` (enforced by ESLint `no-restricted-globals`).

3. **Driver Equivalence Contract:**
   - **`FastDriver`**: Executes a synchronous or microtask-yielding drain loop consuming events directly from the heap until virtual completion.
   - **`RealtimeDriver`**: Uses high-resolution wall-clock timers to pace virtual time advance to $1\times$ real time. When running behind real time (e.g. during heavy traffic bursts), it drains backlog events as fast as possible without dropping, coalescing, or reordering any event.
   - Pacing controls _when_ virtual time advances, never _what_ state transitions occur.
   - Driver Equivalence assertion in verification gates guarantees:
     $$\text{Hash}_{\text{FastDriver}}(\text{world}, \text{seed}) \equiv \text{Hash}_{\text{RealtimeDriver}}(\text{world}, \text{seed})$$

## Consequences

### Positive

- Replay and CI gates execute in milliseconds while producing the exact canonical state hash of a multi-minute realtime run.
- Provable absence of wall-clock leakage into logical state.

### Negative

- When `RealtimeDriver` lags under heavy load, displayed visual events may briefly compress in time until the heap catches up with wall clock.
