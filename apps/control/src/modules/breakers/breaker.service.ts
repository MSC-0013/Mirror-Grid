import { AppError } from '@mirrorgrid/platform';
import { db, schema } from '@mirrorgrid/db';
import { eq } from 'drizzle-orm';
import { BreakerRepository } from './breaker.repository.js';

export class BreakerService {
  private readonly repo: BreakerRepository;

  constructor(repo?: BreakerRepository) {
    this.repo = repo ?? new BreakerRepository();
  }

  public async listBreakers(worldId: string) {
    await this.ensureWorldExists(worldId);

    // Fetch all dependencies to ensure each edge has a breaker record
    const edges = await db
      .select({
        id: schema.serviceDependencies.id,
        sourceServiceId: schema.serviceDependencies.sourceServiceId,
        targetServiceId: schema.serviceDependencies.targetServiceId,
      })
      .from(schema.serviceDependencies)
      .where(eq(schema.serviceDependencies.worldId, worldId));

    const nowMicros = process.hrtime.bigint() / 1000n;

    // Fetch existing records
    const existing = await this.repo.findByWorldId(worldId);
    const edgeToBreaker = new Map(existing.map((b) => [b.edgeId, b]));

    // If any edges lack breaker state records, initialize them
    for (const edge of edges) {
      if (!edgeToBreaker.has(edge.id)) {
        const created = await this.repo.upsertBreakerState(
          worldId,
          edge.targetServiceId,
          edge.id,
          'CLOSED',
          0,
          nowMicros,
        );
        edgeToBreaker.set(edge.id, created);
      }
    }

    // Enrich with service names
    const services = await db
      .select({
        id: schema.services.id,
        name: schema.services.name,
      })
      .from(schema.services)
      .where(eq(schema.services.worldId, worldId));

    const serviceNameMap = new Map(services.map((s) => [s.id, s.name]));
    const edgeMap = new Map(edges.map((e) => [e.id, e]));

    return Array.from(edgeToBreaker.values()).map((breaker) => {
      const edge = breaker.edgeId ? edgeMap.get(breaker.edgeId) : null;
      return {
        ...breaker,
        sourceServiceName: edge
          ? (serviceNameMap.get(edge.sourceServiceId) ?? 'Unknown')
          : 'Gateway',
        targetServiceName: serviceNameMap.get(breaker.serviceId) ?? 'Unknown',
      };
    });
  }

  public async tripBreaker(worldId: string, breakerId: string, reason: string) {
    await this.ensureWorldExists(worldId);
    const breaker = await this.repo.findById(worldId, breakerId);
    if (!breaker) {
      throw AppError.notFound('CircuitBreaker', breakerId);
    }

    const nowMicros = process.hrtime.bigint() / 1000n;
    const updated = await this.repo.updateState(breakerId, 'OPEN', nowMicros, 1_000_000);
    await this.repo.recordTransition(
      worldId,
      breaker.serviceId,
      breaker.edgeId,
      breaker.currentState,
      'OPEN',
      reason,
      nowMicros,
      1_000_000,
    );

    return updated;
  }

  public async resetBreaker(worldId: string, breakerId: string) {
    await this.ensureWorldExists(worldId);
    const breaker = await this.repo.findById(worldId, breakerId);
    if (!breaker) {
      throw AppError.notFound('CircuitBreaker', breakerId);
    }

    const nowMicros = process.hrtime.bigint() / 1000n;
    const updated = await this.repo.updateState(breakerId, 'CLOSED', nowMicros, 0);
    await this.repo.recordTransition(
      worldId,
      breaker.serviceId,
      breaker.edgeId,
      breaker.currentState,
      'CLOSED',
      'MANUAL_RESET',
      nowMicros,
      0,
    );

    return updated;
  }

  public async listTransitions(worldId: string) {
    await this.ensureWorldExists(worldId);
    return this.repo.findTransitions(worldId);
  }

  private async ensureWorldExists(worldId: string): Promise<void> {
    const [world] = await db.select().from(schema.worlds).where(eq(schema.worlds.id, worldId));
    if (!world) {
      throw AppError.notFound('World', worldId);
    }
  }
}
