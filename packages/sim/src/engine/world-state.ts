import { CanonicalSerializer } from '../hash/canonical.js';
import type { HashableComponent } from '../hash/hasher.js';
import type { ServiceModelSnapshot } from '../queueing/service-model.js';
import type { SubStreamSnapshot } from '../rng/substream.js';

/**
 * The canonical, hashable projection of a running world.
 *
 * WHAT IS INCLUDED — everything that can influence future behaviour:
 *   clock position, event sequence counter, per-service slots/queues/counters,
 *   queued request order, and every RNG substream position.
 *
 * WHAT IS EXCLUDED — and why it must be:
 *   - Wall-clock values of any kind. Including them would make FastDriver and
 *     RealtimeDriver hash differently, and driver equivalence is a gate assertion.
 *   - Driver state: lag, batch boundaries, pause intervals.
 *   - Derived metrics and pressure levels: they are computed FROM hashed state, so
 *     hashing them again would add nothing and create a second place to drift.
 *   - Persistence artifacts: row ids, DB sequences.
 */
export interface WorldStateSnapshot {
  readonly engineVersion: string;
  readonly hashSchemaVersion: number;
  readonly clockUs: bigint;
  readonly eventSeqCounter: bigint;
  readonly services: readonly ServiceModelSnapshot[];
  readonly rngStreams: Readonly<Record<string, SubStreamSnapshot>>;
}

export const HASH_SCHEMA_VERSION = 1;

/**
 * One service, hashed independently so a divergence names the service rather than the world.
 */
export class ServiceComponent implements HashableComponent {
  readonly hashKey: string;
  private readonly snapshot: ServiceModelSnapshot;

  constructor(snapshot: ServiceModelSnapshot) {
    this.snapshot = snapshot;
    this.hashKey = `service:${snapshot.serviceId}`;
  }

  writeCanonical(s: CanonicalSerializer): void {
    const snap = this.snapshot;
    s.str(snap.serviceId);
    s.u32(snap.concurrencyLimit);
    s.u32(snap.queueCapacity);
    s.u32(snap.activeSlots);
    s.u32(snap.queueDepth);
    // FIFO order is state: two queues of equal depth holding different requests differ.
    s.array(snap.queuedRequestIds, (ser, id) => ser.str(id));
    s.u32(snap.admittedTotal);
    s.u32(snap.completedTotal);
    s.u32(snap.rejectedTotal);
    s.u32(snap.expiredInQueueTotal);
    s.u64(snap.busyUsAccumulated);
    s.u64(snap.occupancyIntegralUs);
    s.u64(snap.lastChangeUs);
  }
}

/**
 * All RNG substream positions as one component.
 *
 * A snapshot that omits stream positions cannot replay deterministically — the run would
 * resume drawing from the wrong point. This is the single detail most likely to be
 * forgotten, so it is its own hashed component rather than a field on something else.
 */
export class RngComponent implements HashableComponent {
  readonly hashKey = 'rng';
  private readonly streams: Readonly<Record<string, SubStreamSnapshot>>;

  constructor(streams: Readonly<Record<string, SubStreamSnapshot>>) {
    this.streams = streams;
  }

  writeCanonical(s: CanonicalSerializer): void {
    s.sortedMap(this.streams, (ser, stream) => {
      ser.str(stream.name);
      ser.str(stream.initialSeed);
      ser.str(stream.state);
      ser.u32(stream.drawCount);
    });
  }
}

/** Clock position and event sequence — the engine's own progress. */
export class ClockComponent implements HashableComponent {
  readonly hashKey = 'clock';

  constructor(
    private readonly clockUs: bigint,
    private readonly eventSeqCounter: bigint,
    private readonly engineVersion: string,
    private readonly hashSchemaVersion: number,
  ) {}

  writeCanonical(s: CanonicalSerializer): void {
    // Version first: hashes are never comparable across engine or schema versions,
    // and folding the versions in makes that explicit rather than implicit.
    s.str(this.engineVersion);
    s.u32(this.hashSchemaVersion);
    s.u64(this.clockUs);
    s.u64(this.eventSeqCounter);
  }
}

export function buildComponents(state: WorldStateSnapshot): HashableComponent[] {
  const components: HashableComponent[] = [
    new ClockComponent(
      state.clockUs,
      state.eventSeqCounter,
      state.engineVersion,
      state.hashSchemaVersion,
    ),
    new RngComponent(state.rngStreams),
  ];
  for (const service of state.services) {
    components.push(new ServiceComponent(service));
  }
  return components;
}
