import { ComponentHasher, type ComponentHash } from '../hash/hasher.js';
import { MerkleHash } from '../hash/merkle.js';
import { buildComponents, type WorldStateSnapshot } from './world-state.js';

export interface StateHashResult {
  readonly root: string;
  readonly components: ReadonlyMap<string, ComponentHash>;
}

/**
 * The canonical state hash.
 *
 * The guarantee this backs: given the same world, seed, workload and fault schedule, a
 * LOGICAL run produces an identical root on the same engine version and platform.
 *
 * What it does NOT claim: byte-identical JS heap contents, object layout or runtime
 * internals. Those are neither observable nor controllable. The claim is over the
 * canonical representation, which is defined and serialized deliberately.
 */
export function computeStateHash(state: WorldStateSnapshot): StateHashResult {
  const components = buildComponents(state);
  const hashes = ComponentHasher.hashAll(components);
  const merkle = MerkleHash.compute(hashes);
  return { root: merkle.root, components: merkle.components };
}

/** Convenience for assertions and logs that only need the root. */
export function computeStateHashRoot(state: WorldStateSnapshot): string {
  return computeStateHash(state).root;
}

export interface DivergenceReport {
  readonly diverged: boolean;
  readonly expectedRoot: string;
  readonly actualRoot: string;
  /** The first differing component, e.g. `service:payments`. Null when roots match. */
  readonly component: string | null;
  readonly expectedComponentHash?: string;
  readonly actualComponentHash?: string;
}

/**
 * Localize a divergence to a component rather than reporting "the worlds differ".
 * With checkpointing (M11) this narrows further, to the specific event.
 */
export function compareStateHashes(
  expected: StateHashResult,
  actual: StateHashResult
): DivergenceReport {
  if (expected.root === actual.root) {
    return {
      diverged: false,
      expectedRoot: expected.root,
      actualRoot: actual.root,
      component: null,
    };
  }
  const component = MerkleHash.firstDivergence(expected.components, actual.components);
  return {
    diverged: true,
    expectedRoot: expected.root,
    actualRoot: actual.root,
    component,
    expectedComponentHash: component ? expected.components.get(component) : undefined,
    actualComponentHash: component ? actual.components.get(component) : undefined,
  };
}
