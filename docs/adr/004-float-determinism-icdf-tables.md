# ADR 004: Float Determinism via Offline Integer Inverse-CDF Tables

## Status

Accepted

## Context

MIRRORGRID's core architectural claim is that logical simulation runs are fully reproducible: the same seed, world topology, and workload specification must produce an identical sequence of events and a byte-identical canonical state hash.

Under IEEE-754 standard, basic floating-point arithmetic operations (`+`, `-`, `*`, `/`) are deterministic when executed with standard rounding modes. However, transcendental and non-algebraic mathematical functions—notably `Math.log()`, `Math.exp()`, `Math.pow()`, and trigonometric functions—are **not** guaranteed to be correctly rounded to the last Unit in the Last Place (ULP) across different processor architectures (x86-64 vs ARM64) or even across different V8 JavaScript engine releases.

A single ULP difference in an exponential latency calculation can cause a sampled service time to cross an integer-microsecond boundary (e.g. 20,004 µs vs 20,005 µs). This reorders two events in the virtual clock's event heap, diverging all subsequent queueing, retries, and state hashes.

## Decision

We eliminate all floating-point calculations from the simulation's runtime execution path:

1. **Integer Microsecond Domain:** All simulation clocks, scheduling horizons, latencies, deadlines, and durations are represented strictly as integer microseconds (`bigint` or `number` within safe integer range $[0, 2^{53}-1]$).
2. **Offline Precomputed Inverse-CDF Tables:** Latency and stochastic distributions (Exponential, Truncated Normal, Lognormal, Bimodal) are precomputed into lookup tables containing integer microsecond values:
   - Tables are sampled using uniform integer draws from the seeded PRNG: `table[rng.nextIntRange(0, tableSize - 1)]`.
   - The runtime hot path performs zero calls to `Math.log`, `Math.exp`, or `Math.sqrt`.
3. **Manifest Integrity & Drift Guard:**
   - Table checksums are generated and committed into `packages/sim/src/icdf/manifest.ts`.
   - When `SimEngine` initializes, it computes SHA-256 digests of all active ICDF tables and verifies them against the manifest. Any discrepancy throws immediately, failing loudly rather than allowing silent divergence.
4. **Compile-Time Float Rejection:**
   - The canonical serializer types `float()` as `never`, producing a TypeScript compile error if floating-point numbers are passed to the state hasher.
   - Floats are permitted only at the outer reporting boundary (calculating percentiles and error ratios for display).

## Consequences

### Positive

- Cross-platform, cross-CPU, and cross-V8 determinism is guaranteed.
- Fast, $O(1)$ constant-time latency sampling from cache-friendly typed integer arrays.
- Fails immediately and explicitly if an environment produces divergent tables.

### Negative

- Continuous probability distributions are quantized into fine-grained integer buckets (e.g., 10,000 buckets), introducing sub-microsecond quantization. This is acceptable since sub-microsecond precision is below network and software scheduling granularity.
