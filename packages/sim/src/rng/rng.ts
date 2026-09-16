import { deriveStreamSeed } from './splitter.js';
import { SubStream, type SubStreamSnapshot } from './substream.js';

export class SeedableRng {
  readonly rootSeed: bigint;
  private readonly streams: Map<string, SubStream> = new Map();

  constructor(rootSeed: bigint) {
    this.rootSeed = rootSeed;
  }

  /**
   * Derive or retrieve an isolated substream.
   * Creating stream 'A' then stream 'B' guarantees stream 'A' is completely unaffected
   * by any calls or draws from stream 'B' or 'C'.
   */
  stream(name: string): SubStream {
    let substream = this.streams.get(name);
    if (!substream) {
      const substreamSeed = deriveStreamSeed(this.rootSeed, name);
      substream = new SubStream(name, substreamSeed);
      this.streams.set(name, substream);
    }
    return substream;
  }

  getAllStreams(): ReadonlyMap<string, SubStream> {
    return this.streams;
  }

  getSnapshot(): Record<string, SubStreamSnapshot> {
    const snapshot: Record<string, SubStreamSnapshot> = {};
    const sortedKeys = Array.from(this.streams.keys()).sort();
    for (const key of sortedKeys) {
      snapshot[key] = this.streams.get(key)!.getSnapshot();
    }
    return snapshot;
  }
}
