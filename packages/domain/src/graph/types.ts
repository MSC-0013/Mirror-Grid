export type ServiceId = string;

export interface CyclePath {
  services: ServiceId[];
}

export interface GraphMetrics {
  serviceCount: number;
  edgeCount: number;
  hasCycles: boolean;
  criticalPathLength: number;
}

export interface BlastRadius {
  rootServiceId: ServiceId;
  directDependents: ServiceId[];
  transitiveDependents: ServiceId[];
  totalAffected: number;
}
