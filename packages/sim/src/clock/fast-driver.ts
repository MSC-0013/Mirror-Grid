import type { ClockDriver, ClockDriverTarget } from './types.js';

export interface FastDriverOptions {
  batchSize?: number;
  maxVirtualTimeUs?: bigint;
}

export class FastDriver implements ClockDriver {
  readonly name = 'FastDriver';
  private running = false;
  private paused = false;
  private readonly batchSize: number;
  private readonly maxVirtualTimeUs?: bigint;

  constructor(options: FastDriverOptions = {}) {
    this.batchSize = options.batchSize ?? 10000;
    this.maxVirtualTimeUs = options.maxVirtualTimeUs;
  }

  isPaused(): boolean {
    return this.paused;
  }

  pause(): void {
    this.paused = true;
  }

  resume(): void {
    this.paused = false;
  }

  stop(): void {
    this.running = false;
  }

  async start(clock: ClockDriverTarget): Promise<void> {
    this.running = true;
    this.paused = false;

    while (this.running) {
      if (this.paused) {
        await new Promise((resolve) => setTimeout(resolve, 10));
        continue;
      }

      if (!clock.hasEvents()) {
        break;
      }

      const nextTime = clock.peekNextTimeUs();
      if (this.maxVirtualTimeUs !== undefined && nextTime !== null && nextTime > this.maxVirtualTimeUs) {
        break;
      }

      // Process in batches so cooperative event loops (like Promise resolutions) don't starve
      let count = 0;
      while (this.running && !this.paused && clock.hasEvents() && count < this.batchSize) {
        const peekTime = clock.peekNextTimeUs();
        if (this.maxVirtualTimeUs !== undefined && peekTime !== null && peekTime > this.maxVirtualTimeUs) {
          this.running = false;
          break;
        }
        const stepped = clock.step();
        if (!stepped) break;
        count++;
      }

      // Micro-yield to node event loop every batch
      if (this.running && clock.hasEvents()) {
        await new Promise((resolve) => setImmediate(resolve));
      }
    }

    this.running = false;
  }
}
