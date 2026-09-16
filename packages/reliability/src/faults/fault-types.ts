/**
 * Fault types and parameter structures for MIRRORGRID Chaos Fault Engine.
 * STRICT PURITY: Zero external dependencies, zero global state.
 */

export type FaultType =
  | 'LATENCY'
  | 'ERROR'
  | 'PACKET_DROP'
  | 'JITTER'
  | 'BLACKHOLE'
  | 'BANDWIDTH_LIMIT'
  | 'CORRUPT_PAYLOAD'
  | 'SERVICE_KILL';

export interface BaseFaultParams {
  readonly percentage: number; // 1 to 100
}

export interface LatencyFaultParams extends BaseFaultParams {
  readonly latencyMicros: bigint;
  readonly jitterMicros: bigint;
  readonly distribution: 'FIXED' | 'NORMAL' | 'PARETO';
}

export interface ErrorFaultParams extends BaseFaultParams {
  readonly httpStatus: number;
  readonly errorCode: string;
}

export interface PacketDropFaultParams extends BaseFaultParams {
  readonly dropRatioPpm: number; // 0 to 1,000,000 (parts per million)
}

export interface BlackholeFaultParams extends BaseFaultParams {
  readonly durationMicros: bigint;
}

export interface BandwidthLimitFaultParams extends BaseFaultParams {
  readonly bytesPerSec: number;
}

export interface CorruptPayloadFaultParams extends BaseFaultParams {
  readonly corruptMode: 'TRUNCATE' | 'BIT_FLIP' | 'GARBAGE';
}

export interface ServiceKillFaultParams {
  readonly gracePeriodMicros: bigint;
}

export type FaultParameters =
  | LatencyFaultParams
  | ErrorFaultParams
  | PacketDropFaultParams
  | BlackholeFaultParams
  | BandwidthLimitFaultParams
  | CorruptPayloadFaultParams
  | ServiceKillFaultParams
  | Record<string, unknown>;

export interface SafetyRules {
  readonly maxDurationMicros: bigint;
  readonly autoAbortOnBurnRate: boolean;
}

export interface FaultSpec {
  readonly id: string;
  readonly worldId: string;
  readonly name: string;
  readonly description?: string;
  readonly faultType: FaultType;
  readonly targetServiceId?: string;
  readonly targetEdgeId?: string;
  readonly parameters: FaultParameters;
  readonly safetyRules: SafetyRules;
}

export interface ActiveFaultInstance {
  readonly executionId: string;
  readonly spec: FaultSpec;
  readonly startedAtMicros: bigint;
  readonly expiresAtMicros: bigint;
  status: 'ACTIVE' | 'COMPLETED' | 'ABORTED';
}

export interface EdgeFaultEffect {
  readonly drop: boolean;
  readonly injectedLatencyMicros: bigint;
  readonly errorOverride?: {
    readonly httpStatus: number;
    readonly errorCode: string;
  };
}
