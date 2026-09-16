import { AppError } from '@mirrorgrid/platform';
import { db, schema } from '@mirrorgrid/db';
import { eq, count } from 'drizzle-orm';
import { ChaosSafetyBoundary, DEFAULT_SAFETY_CONFIG } from '@mirrorgrid/reliability';
import { FaultRepository } from './fault.repository.js';
import type { CreateFaultSpecInput, InjectFaultInput } from './fault.schema.js';

export class FaultService {
  private readonly repo: FaultRepository;
  private readonly safetyBoundary: ChaosSafetyBoundary;

  constructor(repo?: FaultRepository, safetyBoundary?: ChaosSafetyBoundary) {
    this.repo = repo ?? new FaultRepository();
    this.safetyBoundary = safetyBoundary ?? new ChaosSafetyBoundary(DEFAULT_SAFETY_CONFIG);
  }

  public async createFaultSpec(worldId: string, input: CreateFaultSpecInput) {
    await this.ensureWorldExists(worldId);

    // Verify service/edge targets exist if specified
    if (input.targetServiceId) {
      const [svc] = await db
        .select()
        .from(schema.services)
        .where(eq(schema.services.id, input.targetServiceId));
      if (!svc) {
        throw AppError.notFound('Service', input.targetServiceId);
      }
    }

    if (input.targetEdgeId) {
      const [edge] = await db
        .select()
        .from(schema.serviceDependencies)
        .where(eq(schema.serviceDependencies.id, input.targetEdgeId));
      if (!edge) {
        throw AppError.notFound('Dependency Edge', input.targetEdgeId);
      }
    }

    return this.repo.createSpec(worldId, input);
  }

  public async listFaultSpecs(worldId: string) {
    await this.ensureWorldExists(worldId);
    return this.repo.findSpecsByWorldId(worldId);
  }

  public async getFaultSpec(worldId: string, faultId: string) {
    await this.ensureWorldExists(worldId);
    const spec = await this.repo.findSpecById(worldId, faultId);
    if (!spec) {
      throw AppError.notFound('FaultSpecification', faultId);
    }
    return spec;
  }

  public async injectFault(worldId: string, faultId: string, input: InjectFaultInput) {
    const spec = await this.getFaultSpec(worldId, faultId);

    if (this.safetyBoundary.isAborted) {
      throw AppError.conflict(
        `Chaos safety boundary is in emergency abort state: ${this.safetyBoundary.lastAbortReason}`,
      );
    }

    // Check blast radius
    const [totalEdgesResult] = await db
      .select({ val: count() })
      .from(schema.serviceDependencies)
      .where(eq(schema.serviceDependencies.worldId, worldId));

    const totalEdges = Number(totalEdgesResult?.val ?? 0);
    const activeExecs = await this.repo.findActiveExecutions(worldId);

    const blastCheck = this.safetyBoundary.checkBlastRadius(activeExecs.length + 1, totalEdges);
    if (!blastCheck.allowed) {
      throw AppError.conflict(
        blastCheck.reason ?? 'Injection exceeds maximum blast radius threshold',
      );
    }

    const nowMicros = process.hrtime.bigint() / 1000n;
    const durationMicros = BigInt(input.durationMicros);

    const execution = await this.repo.createExecution(
      worldId,
      faultId,
      nowMicros,
      durationMicros,
      spec.parameters as Record<string, unknown>,
    );

    return execution;
  }

  public async disarmFault(worldId: string, executionId: string) {
    await this.ensureWorldExists(worldId);
    const nowMicros = process.hrtime.bigint() / 1000n;
    const updated = await this.repo.updateExecutionStatus(
      executionId,
      'ABORTED',
      nowMicros,
      'OPERATOR_DISARMED',
    );
    if (!updated) {
      throw AppError.notFound('ActiveFaultExecution', executionId);
    }
    return updated;
  }

  public async emergencyAbort(worldId: string, reason = 'OPERATOR_EMERGENCY_ABORT') {
    await this.ensureWorldExists(worldId);
    this.safetyBoundary.triggerEmergencyAbort(reason);

    const nowMicros = process.hrtime.bigint() / 1000n;
    const aborted = await this.repo.abortAllActiveExecutions(worldId, nowMicros, reason);

    return {
      status: 'ABORTED',
      abortedCount: aborted.length,
      reason,
      abortedAtMicros: nowMicros.toString(),
    };
  }

  public async getActiveFaults(worldId: string) {
    await this.ensureWorldExists(worldId);
    return this.repo.findActiveExecutions(worldId);
  }

  private async ensureWorldExists(worldId: string): Promise<void> {
    const [world] = await db.select().from(schema.worlds).where(eq(schema.worlds.id, worldId));
    if (!world) {
      throw AppError.notFound('World', worldId);
    }
  }
}
