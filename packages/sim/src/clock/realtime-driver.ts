import type { ClockDriver, ClockDriverTarget } from './types.js';

export interface RealtimeDriverOptions {
  speedMultiplier?: number;
  maxVirtualTimeUs?: bigint;
  quantumMs?: number;
}

export class RealtimeDriver implements ClockDriver {
  readonly name = 'RealtimeDriver';
  private running = false;
  private paused = false;
  private readonly speedMultiplier: number;
  private readonly maxVirtualTimeUs?: bigint;
  private readonly quantumMs: number;

  private wallStartMs: number = 0;
  private virtualStartUs: bigint = 0n;
  private lagUs: bigint = 0n;

  constructor(options: RealtimeDriverOptions = {}) {
    this.speedMultiplier = options.speedMultiplier ?? 1.0;
    this.maxVirtualTimeUs = options.maxVirtualTimeUs;
    this.quantumMs = options.quantumMs ?? 5;
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

  getLagUs(): bigint {
    return this.lagUs;
  }

  async start(clock: ClockDriverTarget): Promise<void> {
    this.running = true;
    this.paused = false;
    this.virtualStartUs = clock.nowUs();
    this.wallStartMs = performance.now();

    while (this.running) {
      if (this.paused) {
        await new Promise((resolve) => setTimeout(resolve, this.quantumMs));
        // Reset wall clock baseline so pause doesn't manifest as massive lag
        this.wallStartMs = performance.now();
        this.virtualStartUs = clock.nowUs();
        continue;
      }

      if (!clock.hasEvents()) {
        break;
      }

      const nextTimeUs = clock.peekNextTimeUs();
      if (
        this.maxVirtualTimeUs !== undefined &&
        nextTimeUs !== null &&
        nextTimeUs > this.maxVirtualTimeUs
      ) {
        break;
      }

      const elapsedWallMs = performance.now() - this.wallStartMs;
      // Convert wall elapsed ms to target virtual us scaled by multiplier
      const targetVirtualElapsedUs = BigInt(
        Math.floor(elapsedWallMs * 1000 * this.speedMultiplier),
      );
      const targetVirtualTimeUs = this.virtualStartUs + targetVirtualElapsedUs;

      // Process any events whose scheduled time <= targetVirtualTimeUs
      let processedInBatch = 0;
      while (this.running && !this.paused && clock.hasEvents()) {
        const eventTimeUs = clock.peekNextTimeUs();
        if (eventTimeUs === null) break;
        if (this.maxVirtualTimeUs !== undefined && eventTimeUs > this.maxVirtualTimeUs) {
          this.running = false;
          break;
        }

        if (eventTimeUs <= targetVirtualTimeUs) {
          clock.step();
          processedInBatch++;
          // Periodically yield if backlog is huge
          if (processedInBatch >= 500) {
            break;
          }
        } else {
          // Next event is in the future relative to paced wall time
          const waitUs = eventTimeUs - targetVirtualTimeUs;
          const waitMs = Number(waitUs) / (1000 * this.speedMultiplier);
          const sleepMs = Math.max(1, Math.min(waitMs, this.quantumMs));
          await new Promise((resolve) => setTimeout(resolve, sleepMs));
          break;
        }
      }

      // Check lag: if next event was due before targetVirtualTimeUs, calculate lag
      const currentNextUs = clock.peekNextTimeUs();
      if (currentNextUs !== null && currentNextUs < targetVirtualTimeUs) {
        this.lagUs = targetVirtualTimeUs - currentNextUs;
      } else {
        this.lagUs = 0n;
      }

      // Yield briefly between quantums
      await new Promise((resolve) => setTimeout(resolve, 0));
    }

    this.running = false;
  }
}
