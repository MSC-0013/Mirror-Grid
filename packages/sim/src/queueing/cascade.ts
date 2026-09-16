import type { BoundedConcurrencyService } from './service-model.js';

export type PressureLevel = 'NOMINAL' | 'ELEVATED' | 'SATURATED' | 'SHEDDING';

export interface ServicePressure {
  readonly serviceId: string;
  /** activeSlots / concurrencyLimit in parts-per-billion. Integer. */
  readonly saturationPpb: number;
  /** queueDepth / queueCapacity in parts-per-billion. Integer. */
  readonly queuePressurePpb: number;
  readonly level: PressureLevel;
  readonly backpressure: boolean;
}

const ELEVATED_PPB = 700_000_000; // 70%
const SATURATED_PPB = 950_000_000; // 95%

/**
 * Observes saturation and backpressure across services.
 *
 * This is strictly an OBSERVER. It never changes behaviour, never feeds back into the
 * simulation, and nothing it computes enters the canonical state hash — pressure is
 * derived from state that is already hashed. Keeping it read-only is what allows the
 * cascade to remain emergent rather than steered.
 */
export class CascadeDetector {
  private readonly services = new Map<string, BoundedConcurrencyService>();

  register(service: BoundedConcurrencyService): void {
    this.services.set(service.serviceId, service);
  }

  pressureFor(serviceId: string): ServicePressure | undefined {
    const service = this.services.get(serviceId);
    return service ? this.computePressure(service) : undefined;
  }

  /** Sorted by serviceId so output is deterministic regardless of registration order. */
  snapshot(): ServicePressure[] {
    return Array.from(this.services.keys())
      .sort()
      .map((id) => this.computePressure(this.services.get(id)!));
  }

  /** Services currently shedding — the visible edge of a cascade. */
  sheddingServices(): string[] {
    return this.snapshot()
      .filter((p) => p.level === 'SHEDDING')
      .map((p) => p.serviceId);
  }

  private computePressure(service: BoundedConcurrencyService): ServicePressure {
    const saturationPpb = service.saturationPpb;
    const queuePressurePpb =
      service.queueCapacity === 0
        ? 0
        : Math.floor((service.queueDepth * 1_000_000_000) / service.queueCapacity);

    let level: PressureLevel = 'NOMINAL';
    if (queuePressurePpb >= 1_000_000_000) {
      level = 'SHEDDING';
    } else if (saturationPpb >= SATURATED_PPB) {
      level = 'SATURATED';
    } else if (saturationPpb >= ELEVATED_PPB) {
      level = 'ELEVATED';
    }

    return {
      serviceId: service.serviceId,
      saturationPpb,
      queuePressurePpb,
      level,
      // Backpressure begins the moment work queues rather than being served immediately.
      backpressure: service.queueDepth > 0,
    };
  }
}
