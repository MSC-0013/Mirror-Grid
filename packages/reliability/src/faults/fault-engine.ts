/**
 * FaultEngine: Pure In-Memory Fault Coordinator
 *
 * Coordinates active fault injections, maps targets (edge, service, global),
 * and computes exact deterministic side-effects (latency shifts, drops, error overrides)
 * during call evaluation.
 *
 * ZERO dependencies, ZERO Date.now(), ZERO timers.
 */

import type {
  FaultSpec,
  ActiveFaultInstance,
  EdgeFaultEffect,
  LatencyFaultParams,
  ErrorFaultParams,
  PacketDropFaultParams,
} from './fault-types.js';
import { ChaosSafetyBoundary } from './safety-boundary.js';

export class FaultEngine {
  private readonly activeFaults: Map<string, ActiveFaultInstance> = new Map();
  public readonly safetyBoundary: ChaosSafetyBoundary;

  constructor(safetyBoundary?: ChaosSafetyBoundary) {
    this.safetyBoundary = safetyBoundary ?? new ChaosSafetyBoundary();
  }

  /**
   * Register and activate a fault injection instance.
   */
  public injectFault(
    spec: FaultSpec,
    executionId: string,
    nowMicros: bigint,
    durationMicros: bigint,
  ): ActiveFaultInstance {
    // Check if safety boundary is already in emergency abort
    if (this.safetyBoundary.isAborted) {
      throw new Error(
        `Cannot inject fault: Safety boundary is in abort state (${this.safetyBoundary.lastAbortReason})`,
      );
    }

    // Leased lifetime: cap duration to maxDurationMicros
    const cappedDuration =
      durationMicros > spec.safetyRules.maxDurationMicros
        ? spec.safetyRules.maxDurationMicros
        : durationMicros;

    const expiresAtMicros = nowMicros + cappedDuration;

    const instance: ActiveFaultInstance = {
      executionId,
      spec,
      startedAtMicros: nowMicros,
      expiresAtMicros,
      status: 'ACTIVE',
    };

    this.activeFaults.set(executionId, instance);
    return instance;
  }

  /**
   * Disarm / deactivate a running fault.
   */
  public disarmFault(executionId: string, _nowMicros: bigint): boolean {
    const fault = this.activeFaults.get(executionId);
    if (!fault || fault.status !== 'ACTIVE') {
      return false;
    }

    fault.status = 'ABORTED';
    this.activeFaults.delete(executionId);
    return true;
  }

  /**
   * Emergency global abort: Immediately halts and purges all active faults.
   */
  public emergencyAbortAll(_nowMicros: bigint, reason = 'GLOBAL_EMERGENCY_ABORT'): number {
    this.safetyBoundary.triggerEmergencyAbort(reason);
    let count = 0;
    for (const fault of this.activeFaults.values()) {
      if (fault.status === 'ACTIVE') {
        fault.status = 'ABORTED';
        count++;
      }
    }
    this.activeFaults.clear();
    return count;
  }

  /**
   * Returns list of currently active (non-expired) faults.
   */
  public getActiveFaults(nowMicros: bigint): ActiveFaultInstance[] {
    this.pruneExpired(nowMicros);
    return Array.from(this.activeFaults.values());
  }

  /**
   * Evaluates the net fault effect on an edge call.
   */
  public evaluateEdgeCall(
    edgeId: string,
    sourceServiceId: string,
    targetServiceId: string,
    nowMicros: bigint,
    prngUniform = 0.0,
  ): EdgeFaultEffect {
    if (this.safetyBoundary.isAborted) {
      return { drop: false, injectedLatencyMicros: 0n };
    }

    this.pruneExpired(nowMicros);

    let drop = false;
    let injectedLatencyMicros = 0n;
    let errorOverride: { httpStatus: number; errorCode: string } | undefined;

    for (const fault of this.activeFaults.values()) {
      if (fault.status !== 'ACTIVE') continue;

      const spec = fault.spec;
      const matchesTarget =
        (spec.targetEdgeId && spec.targetEdgeId === edgeId) ||
        (spec.targetServiceId &&
          (spec.targetServiceId === targetServiceId || spec.targetServiceId === sourceServiceId)) ||
        (!spec.targetEdgeId && !spec.targetServiceId); // Global fault

      if (!matchesTarget) continue;

      const percentage = (spec.parameters as { percentage?: number }).percentage ?? 100;
      const rolledPercent = prngUniform * 100;
      if (rolledPercent >= percentage) continue;

      switch (spec.faultType) {
        case 'LATENCY': {
          const lp = spec.parameters as LatencyFaultParams;
          injectedLatencyMicros += lp.latencyMicros;
          break;
        }
        case 'ERROR': {
          const ep = spec.parameters as ErrorFaultParams;
          errorOverride = {
            httpStatus: ep.httpStatus,
            errorCode: ep.errorCode,
          };
          break;
        }
        case 'PACKET_DROP': {
          const pd = spec.parameters as PacketDropFaultParams;
          const dropPpm = pd.dropRatioPpm ?? 1_000_000;
          if (Math.floor(prngUniform * 1_000_000) < dropPpm) {
            drop = true;
          }
          break;
        }
        case 'BLACKHOLE': {
          drop = true;
          break;
        }
        default:
          break;
      }
    }

    return {
      drop,
      injectedLatencyMicros,
      errorOverride,
    };
  }

  private pruneExpired(nowMicros: bigint): void {
    for (const [id, fault] of this.activeFaults.entries()) {
      if (nowMicros >= fault.expiresAtMicros) {
        fault.status = 'COMPLETED';
        this.activeFaults.delete(id);
      }
    }
  }
}
