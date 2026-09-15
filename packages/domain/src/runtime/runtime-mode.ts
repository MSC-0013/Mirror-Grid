export type RuntimeMode = 'LOGICAL' | 'CONTAINER' | 'HYBRID';
export type DeterminismClass = 'DETERMINISTIC' | 'SEEDED_INPUTS' | 'NON_DETERMINISTIC';

export interface RuntimeCapabilities {
  readonly mode: RuntimeMode;
  readonly determinism: DeterminismClass;
  readonly maxServices: number;
  readonly maxWorkloadRate: number;
  readonly supportedFaults: string[];
  readonly supportsReplayVerification: boolean;
  readonly forcedDriver?: 'REALTIME';
}

export interface RuntimeHandle {
  readonly id: string;
  readonly mode: RuntimeMode;
  readonly worldId: string;
}
