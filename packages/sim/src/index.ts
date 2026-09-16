/**
 * @mirrorgrid/sim — deterministic discrete-event simulation engine.
 *
 * PURITY CONTRACT (enforced by CI, not convention):
 *   - Zero workspace dependencies. This package imports nothing from @mirrorgrid/*.
 *     The RuntimeAdapter implementation lives in apps/simulation precisely so that the
 *     adapter can depend on @mirrorgrid/domain while the engine stays standalone.
 *   - No Date.now(), no Math.random(). Wall clock appears only inside RealtimeDriver,
 *     where it paces advancement and never supplies simulation time.
 *   - No floats in hashed state. CanonicalSerializer.float() is typed `never`.
 */

export * from './clock/index.js';
export * from './rng/index.js';
export * from './icdf/index.js';
export * from './queueing/index.js';
export * from './metrics/index.js';
export * from './hash/index.js';
export * from './workload/index.js';
export * from './engine/index.js';
