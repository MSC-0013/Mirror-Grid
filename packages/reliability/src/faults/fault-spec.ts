/**
 * Fault specification validator and factory.
 * Pure logic, zero runtime dependencies.
 */

import type { FaultSpec, FaultType, SafetyRules } from './fault-types.js';

export const DEFAULT_SAFETY_RULES: SafetyRules = {
  maxDurationMicros: 300_000_000n, // 5 minutes default hard cap
  autoAbortOnBurnRate: true,
};

export class FaultSpecValidator {
  public static validate(spec: Partial<FaultSpec>): string | null {
    if (!spec.id || typeof spec.id !== 'string') return 'Missing or invalid spec.id';
    if (!spec.worldId || typeof spec.worldId !== 'string') return 'Missing or invalid spec.worldId';
    if (!spec.name || typeof spec.name !== 'string') return 'Missing or invalid spec.name';

    const validTypes: FaultType[] = [
      'LATENCY',
      'ERROR',
      'PACKET_DROP',
      'JITTER',
      'BLACKHOLE',
      'BANDWIDTH_LIMIT',
      'CORRUPT_PAYLOAD',
      'SERVICE_KILL',
    ];

    if (!spec.faultType || !validTypes.includes(spec.faultType)) {
      return `Invalid faultType: ${spec.faultType}`;
    }

    if (spec.targetServiceId && spec.targetEdgeId) {
      return 'Fault cannot target both service and edge simultaneously';
    }

    if (spec.safetyRules) {
      if (spec.safetyRules.maxDurationMicros <= 0n) {
        return 'maxDurationMicros must be positive';
      }
    }

    return null;
  }
}
