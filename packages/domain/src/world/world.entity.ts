export type WorldStatus = 'IDLE' | 'RUNNING' | 'PAUSED' | 'COMPLETED' | 'FAILED';
export type WorldRuntimeMode = 'LOGICAL' | 'CONTAINER' | 'HYBRID';

export const WORLD_STATUSES: readonly WorldStatus[] = [
  'IDLE',
  'RUNNING',
  'PAUSED',
  'COMPLETED',
  'FAILED',
] as const;

export const WORLD_STATUS_TRANSITIONS: Record<WorldStatus, readonly WorldStatus[]> = {
  IDLE: ['RUNNING'],
  RUNNING: ['PAUSED', 'COMPLETED', 'FAILED'],
  PAUSED: ['RUNNING', 'FAILED'],
  COMPLETED: [],
  FAILED: [],
};

export function isValidWorldTransition(from: WorldStatus, to: WorldStatus): boolean {
  if (from === to) return true;
  const allowed = WORLD_STATUS_TRANSITIONS[from];
  return allowed ? allowed.includes(to) : false;
}

export function assertValidWorldTransition(from: WorldStatus, to: WorldStatus): void {
  if (!isValidWorldTransition(from, to)) {
    throw new Error(`Illegal world status transition from '${from}' to '${to}'`);
  }
}

export interface World {
  id: string;
  organizationId: string;
  name: string;
  description: string | null;
  status: WorldStatus;
  runtimeMode: WorldRuntimeMode;
  seed: bigint;
  eventSeq: bigint;
  config: Record<string, unknown>;
  createdAt: Date;
  updatedAt: Date;
}
