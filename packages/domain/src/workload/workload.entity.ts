export type WorkloadPattern = 'CONSTANT' | 'RAMP_UP' | 'RAMP_DOWN' | 'BURST' | 'SPIKE' | 'RANDOM';

export const WORKLOAD_PATTERNS: readonly WorkloadPattern[] = [
  'CONSTANT',
  'RAMP_UP',
  'RAMP_DOWN',
  'BURST',
  'SPIKE',
  'RANDOM',
] as const;

export interface Workload {
  id: string;
  worldId: string;
  name: string;
  targetServiceId: string;
  pattern: WorkloadPattern;
  baseRate: number;
  peakRate: number | null;
  durationMs: bigint | null;
  config: Record<string, unknown>;
  createdAt: Date;
  updatedAt: Date;
}
