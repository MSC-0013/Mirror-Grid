import { createHash } from 'node:crypto';
import { CanonicalSerializer } from './canonical.js';

export type ComponentHash = string; // lowercase hex SHA-256

export interface HashableComponent {
  /** Stable identity, e.g. `service:018f...`. Sorted by this when building the Merkle root. */
  readonly hashKey: string;
  writeCanonical(serializer: CanonicalSerializer): void;
}

export class ComponentHasher {
  /** Hash one component independently — this is what makes divergence localizable. */
  static hash(component: HashableComponent): ComponentHash {
    const serializer = new CanonicalSerializer();
    component.writeCanonical(serializer);
    return ComponentHasher.hashBuffer(serializer.toBuffer());
  }

  static hashBuffer(buffer: Buffer): ComponentHash {
    return createHash('sha256').update(buffer).digest('hex');
  }

  static hashAll(components: readonly HashableComponent[]): Map<string, ComponentHash> {
    const result = new Map<string, ComponentHash>();
    for (const component of components) {
      result.set(component.hashKey, ComponentHasher.hash(component));
    }
    return result;
  }
}
