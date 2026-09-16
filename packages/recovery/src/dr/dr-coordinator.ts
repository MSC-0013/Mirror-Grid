import {
  MerkleSnapshotService,
  type MerkleSnapshot,
} from '../snapshot/snapshot-service.js';
import { RpoRtoCalculator, DEFAULT_DR_OBJECTIVES, type RecoveryObjectives } from './rpo-rto-calculator.js';

export interface DrDrillResult {
  readonly restorationId: string;
  readonly snapshotId: string;
  readonly rpoMicros: number;
  readonly rtoMs: number;
  readonly hashVerified: boolean;
  readonly restoredComponentsCount: number;
  readonly status: 'COMPLETED' | 'FAILED';
  readonly compliance: {
    readonly rpoCompliant: boolean;
    readonly rtoCompliant: boolean;
    readonly fullyCompliant: boolean;
  };
}

export class DisasterRecoveryCoordinator {
  /**
   * Executes a simulated Disaster Recovery restoration drill from a snapshot.
   */
  static executeDrill(params: {
    snapshot: MerkleSnapshot;
    disasterTimeMicros: number;
    restorerName?: string;
    objectives?: RecoveryObjectives;
  }): DrDrillResult {
    const { snapshot, disasterTimeMicros, objectives = DEFAULT_DR_OBJECTIVES } = params;
    const startWallTime = Date.now();

    // 1. Calculate RPO
    const rpoMicros = RpoRtoCalculator.calculateRpo(
      disasterTimeMicros,
      snapshot.simTimeMicros,
    );

    // 2. Reconstitute components and verify Merkle root hash
    const restoredComponents = [...snapshot.components];
    const computedRoot = MerkleSnapshotService.computeMerkleRoot(restoredComponents);
    const hashVerified = computedRoot === snapshot.merkleRootHash;

    const endWallTime = Date.now();
    const rtoMs = RpoRtoCalculator.calculateRto(startWallTime, endWallTime);

    const compliance = RpoRtoCalculator.evaluateCompliance(rpoMicros, rtoMs, objectives);

    return {
      restorationId: crypto.randomUUID(),
      snapshotId: snapshot.id,
      rpoMicros,
      rtoMs,
      hashVerified,
      restoredComponentsCount: restoredComponents.length,
      status: hashVerified ? 'COMPLETED' : 'FAILED',
      compliance,
    };
  }
}
