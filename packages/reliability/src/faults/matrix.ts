/**
 * Matrix of supported faults across execution runtimes.
 */

import type { FaultType } from './fault-types.js';

export interface RuntimeCompatibility {
  readonly faultType: FaultType;
  readonly supportedInSim: boolean;
  readonly supportedInContainer: boolean;
  readonly mechanism: string;
}

export const FAULT_COMPATIBILITY_MATRIX: readonly RuntimeCompatibility[] = [
  {
    faultType: 'LATENCY',
    supportedInSim: true,
    supportedInContainer: true,
    mechanism: 'Virtual Clock delay / Toxiproxy latency',
  },
  {
    faultType: 'ERROR',
    supportedInSim: true,
    supportedInContainer: true,
    mechanism: 'Synthetic response override / HTTP 5xx injector',
  },
  {
    faultType: 'PACKET_DROP',
    supportedInSim: true,
    supportedInContainer: true,
    mechanism: 'Drop event / Toxiproxy drop',
  },
  {
    faultType: 'JITTER',
    supportedInSim: true,
    supportedInContainer: true,
    mechanism: 'PRNG ICDF variation / Toxiproxy jitter',
  },
  {
    faultType: 'BLACKHOLE',
    supportedInSim: true,
    supportedInContainer: true,
    mechanism: 'Unresponsive connection drop / iptables DROP',
  },
  {
    faultType: 'BANDWIDTH_LIMIT',
    supportedInSim: true,
    supportedInContainer: true,
    mechanism: 'Serialized rate shaping / Toxiproxy rate limit',
  },
  {
    faultType: 'CORRUPT_PAYLOAD',
    supportedInSim: true,
    supportedInContainer: true,
    mechanism: 'Body mutation / Slicing buffer',
  },
  {
    faultType: 'SERVICE_KILL',
    supportedInSim: true,
    supportedInContainer: true,
    mechanism: 'SimEngine instance descheduling / Docker container stop',
  },
] as const;
