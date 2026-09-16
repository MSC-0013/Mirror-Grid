export type ServiceType = 'HTTP' | 'GRPC' | 'WORKER' | 'DATABASE' | 'CACHE' | 'MESSAGE_BROKER';

export type ServiceStatus =
  | 'STOPPED'
  | 'STARTING'
  | 'HEALTHY'
  | 'DEGRADED'
  | 'PARTIALLY_AVAILABLE'
  | 'UNHEALTHY'
  | 'FAILED'
  | 'UNKNOWN';

export const SERVICE_STATUSES: readonly ServiceStatus[] = [
  'STOPPED',
  'STARTING',
  'HEALTHY',
  'DEGRADED',
  'PARTIALLY_AVAILABLE',
  'UNHEALTHY',
  'FAILED',
  'UNKNOWN',
] as const;

export const SERVICE_TYPES: readonly ServiceType[] = [
  'HTTP',
  'GRPC',
  'WORKER',
  'DATABASE',
  'CACHE',
  'MESSAGE_BROKER',
] as const;

export const SERVICE_STATUS_TRANSITIONS: Record<ServiceStatus, readonly ServiceStatus[]> = {
  STOPPED: ['STARTING'],
  STARTING: ['HEALTHY', 'DEGRADED', 'PARTIALLY_AVAILABLE', 'UNHEALTHY', 'FAILED'],
  HEALTHY: ['DEGRADED', 'PARTIALLY_AVAILABLE', 'UNHEALTHY', 'FAILED', 'STOPPED'],
  DEGRADED: ['HEALTHY', 'PARTIALLY_AVAILABLE', 'UNHEALTHY', 'FAILED', 'STOPPED'],
  PARTIALLY_AVAILABLE: ['HEALTHY', 'DEGRADED', 'UNHEALTHY', 'FAILED', 'STOPPED'],
  UNHEALTHY: ['HEALTHY', 'DEGRADED', 'PARTIALLY_AVAILABLE', 'FAILED', 'STOPPED'],
  FAILED: ['STARTING', 'STOPPED'],
  UNKNOWN: ['HEALTHY', 'DEGRADED', 'PARTIALLY_AVAILABLE', 'UNHEALTHY', 'FAILED', 'STOPPED'],
};

export function isValidServiceTransition(from: ServiceStatus, to: ServiceStatus): boolean {
  if (from === to) return true;
  const allowed = SERVICE_STATUS_TRANSITIONS[from];
  return allowed ? allowed.includes(to) : false;
}

export function assertValidServiceTransition(from: ServiceStatus, to: ServiceStatus): void {
  if (!isValidServiceTransition(from, to)) {
    throw new Error(`Illegal service status transition from '${from}' to '${to}'`);
  }
}

export interface Service {
  id: string;
  worldId: string;
  name: string;
  description: string | null;
  serviceType: ServiceType;
  status: ServiceStatus;
  targetInstances: number;
  concurrencyLimit: number;
  queueCapacity: number;
  config: Record<string, unknown>;
  createdAt: Date;
  updatedAt: Date;
}

export interface ServiceInstance {
  id: string;
  serviceId: string;
  worldId: string;
  instanceIndex: number;
  status: ServiceStatus;
  containerId: string | null;
  createdAt: Date;
  updatedAt: Date;
}
