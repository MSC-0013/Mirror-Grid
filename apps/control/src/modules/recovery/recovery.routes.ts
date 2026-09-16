import type { FastifyInstance } from 'fastify';
import { eq, and, desc } from 'drizzle-orm';
import {
  db,
  services,
  serviceDependencies,
  worldSnapshots,
  snapshotComponents,
  drRestorations,
} from '@mirrorgrid/db';
import {
  MerkleSnapshotService,
  CheckpointBisector,
  ReplayEngine,
  DisasterRecoveryCoordinator,
  type ComponentSnapshot,
  type MerkleSnapshot,
  type RecordedEvent,
} from '@mirrorgrid/recovery';
import { AppError } from '@mirrorgrid/platform';
import { z } from 'zod';

const createSnapshotSchema = z.object({
  simTimeMicros: z.number().int().nonnegative().optional(),
  sequenceNum: z.number().int().positive().optional(),
  experimentRunId: z.string().optional(),
  reason: z.string().max(120).optional(),
  snapshotType: z.enum(['PERIODIC', 'TRIGGERED', 'MANUAL', 'PRE_FAULT']).optional(),
  components: z
    .array(
      z.object({
        componentType: z.enum(['SERVICE_STATE', 'CIRCUIT_BREAKER', 'QUEUE_STATE', 'FAULT_STATE']),
        componentId: z.string(),
        payload: z.record(z.string(), z.unknown()),
      }),
    )
    .optional(),
});

const replayRequestSchema = z.object({
  snapshotId: z.string().optional(),
  targetSimTimeMicros: z.number().int().nonnegative(),
  events: z
    .array(
      z.object({
        timestampMicros: z.number(),
        eventType: z.string(),
        targetServiceId: z.string(),
        payload: z.record(z.string(), z.unknown()),
      }),
    )
    .optional(),
});

const bisectRequestSchema = z.object({
  run1Id: z.string(),
  run2Id: z.string(),
});

const drDrillSchema = z.object({
  snapshotId: z.string(),
  disasterTimeMicros: z.number().int().positive().optional(),
});

export async function recoveryRoutes(fastify: FastifyInstance) {
  // 1. Capture World Checkpoint (Merkle Snapshot)
  fastify.post(
    '/worlds/:worldId/recovery/snapshots',
    {
      preHandler: [fastify.requirePermission('topology:write')],
    },
    async (req, reply) => {
      const params = req.params as { worldId: string };
      const body = createSnapshotSchema.parse(req.body ?? {});

      let components: ComponentSnapshot[] = [];

      if (body.components && body.components.length > 0) {
        components = body.components.map((c) =>
          MerkleSnapshotService.createComponent(c.componentType, c.componentId, c.payload),
        );
      } else {
        // Derive components from live world state (services + dependencies)
        const svcs = await db.select().from(services).where(eq(services.worldId, params.worldId));
        const deps = await db
          .select()
          .from(serviceDependencies)
          .where(eq(serviceDependencies.worldId, params.worldId));

        for (const s of svcs) {
          components.push(
            MerkleSnapshotService.createComponent('SERVICE_STATE', s.id, {
              name: s.name,
              status: s.status,
              targetInstances: s.targetInstances,
              concurrencyLimit: s.concurrencyLimit,
              queueCapacity: s.queueCapacity,
            }),
          );
        }

        for (const d of deps) {
          components.push(
            MerkleSnapshotService.createComponent('CIRCUIT_BREAKER', `${d.sourceServiceId}->${d.targetServiceId}`, {
              timeoutMs: d.timeoutMs,
              criticality: d.criticality,
              retryPolicy: d.retryPolicy,
            }),
          );
        }
      }

      // Fetch previous snapshot for deduplication
      const [prevSnapshotRow] = await db
        .select()
        .from(worldSnapshots)
        .where(eq(worldSnapshots.worldId, params.worldId))
        .orderBy(desc(worldSnapshots.simTimeMicros))
        .limit(1);

      let prevSnapshot: MerkleSnapshot | undefined;
      if (prevSnapshotRow) {
        const prevComps = await db
          .select()
          .from(snapshotComponents)
          .where(eq(snapshotComponents.snapshotId, prevSnapshotRow.id));

        prevSnapshot = {
          id: prevSnapshotRow.id,
          worldId: prevSnapshotRow.worldId,
          experimentRunId: prevSnapshotRow.experimentRunId ?? undefined,
          simTimeMicros: prevSnapshotRow.simTimeMicros,
          sequenceNum: prevSnapshotRow.sequenceNum,
          merkleRootHash: prevSnapshotRow.merkleRootHash,
          snapshotType: prevSnapshotRow.snapshotType as MerkleSnapshot['snapshotType'],
          totalComponents: prevSnapshotRow.totalComponents,
          deduplicatedComponents: prevSnapshotRow.deduplicatedComponents,
          sizeBytes: prevSnapshotRow.sizeBytes,
          components: prevComps.map((pc) => ({
            componentType: pc.componentType as ComponentSnapshot['componentType'],
            componentId: pc.componentId,
            componentHash: pc.componentHash,
            payload: pc.statePayload,
            isDeduplicated: pc.isDeduplicated,
          })),
        };
      }

      const seq = body.sequenceNum ?? (prevSnapshot ? prevSnapshot.sequenceNum + 1 : 1);
      const simTime = body.simTimeMicros ?? (prevSnapshot ? prevSnapshot.simTimeMicros + 1000 : 1000);

      const snapshot = MerkleSnapshotService.createSnapshot({
        worldId: params.worldId,
        experimentRunId: body.experimentRunId,
        simTimeMicros: simTime,
        sequenceNum: seq,
        components,
        previousSnapshot: prevSnapshot,
        snapshotType: body.snapshotType ?? 'PERIODIC',
        triggerReason: body.reason,
      });

      // Save to database
      await db.insert(worldSnapshots).values({
        id: snapshot.id,
        worldId: snapshot.worldId,
        experimentRunId: snapshot.experimentRunId ?? null,
        simTimeMicros: snapshot.simTimeMicros,
        sequenceNum: snapshot.sequenceNum,
        merkleRootHash: snapshot.merkleRootHash,
        snapshotType: snapshot.snapshotType,
        triggerReason: snapshot.triggerReason ?? null,
        totalComponents: snapshot.totalComponents,
        deduplicatedComponents: snapshot.deduplicatedComponents,
        sizeBytes: snapshot.sizeBytes,
      });

      if (snapshot.components.length > 0) {
        await db.insert(snapshotComponents).values(
          snapshot.components.map((c) => ({
            snapshotId: snapshot.id,
            componentType: c.componentType,
            componentId: c.componentId,
            componentHash: c.componentHash,
            statePayload: c.payload,
            isDeduplicated: c.isDeduplicated ?? false,
          })),
        );
      }

      return reply.code(201).send(snapshot);
    },
  );

  // 2. List World Snapshots
  fastify.get(
    '/worlds/:worldId/recovery/snapshots',
    {
      preHandler: [fastify.requirePermission('topology:read')],
    },
    async (req) => {
      const params = req.params as { worldId: string };
      const list = await db
        .select()
        .from(worldSnapshots)
        .where(eq(worldSnapshots.worldId, params.worldId))
        .orderBy(desc(worldSnapshots.simTimeMicros))
        .limit(50);

      return { data: list };
    },
  );

  // 3. Rewind & Replay Incident
  fastify.post(
    '/worlds/:worldId/recovery/replay',
    {
      preHandler: [fastify.requirePermission('experiments:run')],
    },
    async (req) => {
      const params = req.params as { worldId: string };
      const body = replayRequestSchema.parse(req.body);

      // Load baseline snapshot
      const snapshotRow = (
        body.snapshotId
          ? await db
              .select()
              .from(worldSnapshots)
              .where(
                and(
                  eq(worldSnapshots.id, body.snapshotId),
                  eq(worldSnapshots.worldId, params.worldId),
                ),
              )
          : await db
              .select()
              .from(worldSnapshots)
              .where(eq(worldSnapshots.worldId, params.worldId))
              .orderBy(desc(worldSnapshots.simTimeMicros))
              .limit(1)
      )[0];

      if (!snapshotRow) {
        throw AppError.notFound('Snapshot', body.snapshotId);
      }

      const compRows = await db
        .select()
        .from(snapshotComponents)
        .where(eq(snapshotComponents.snapshotId, snapshotRow.id));

      const baselineSnapshot: MerkleSnapshot = {
        id: snapshotRow.id,
        worldId: snapshotRow.worldId,
        simTimeMicros: snapshotRow.simTimeMicros,
        sequenceNum: snapshotRow.sequenceNum,
        merkleRootHash: snapshotRow.merkleRootHash,
        snapshotType: snapshotRow.snapshotType as MerkleSnapshot['snapshotType'],
        totalComponents: snapshotRow.totalComponents,
        deduplicatedComponents: snapshotRow.deduplicatedComponents,
        sizeBytes: snapshotRow.sizeBytes,
        components: compRows.map((c) => ({
          componentType: c.componentType as ComponentSnapshot['componentType'],
          componentId: c.componentId,
          componentHash: c.componentHash,
          payload: c.statePayload,
          isDeduplicated: c.isDeduplicated,
        })),
      };

      const result = ReplayEngine.replay({
        baselineSnapshot,
        events: (body.events as RecordedEvent[]) ?? [],
        targetSimTimeMicros: body.targetSimTimeMicros,
      });

      return {
        status: result.status === 'REPLAY_SUCCESS' ? 'REPLAY_READY' : 'REPLAY_DIVERGED',
        simTimeMicros: result.targetSimTimeMicros,
        stateHash: result.replayedStateHash,
        hashMatches: result.hashMatches,
        eventsProcessed: result.eventsProcessed,
      };
    },
  );

  // 4. Bisect Divergence
  fastify.post(
    '/worlds/:worldId/recovery/bisect',
    {
      preHandler: [fastify.requirePermission('experiments:read')],
    },
    async (req) => {
      const body = bisectRequestSchema.parse(req.body);

      // Load run 1 snapshots
      const r1Rows = await db
        .select()
        .from(worldSnapshots)
        .where(eq(worldSnapshots.experimentRunId, body.run1Id))
        .orderBy(worldSnapshots.sequenceNum);

      // Load run 2 snapshots
      const r2Rows = await db
        .select()
        .from(worldSnapshots)
        .where(eq(worldSnapshots.experimentRunId, body.run2Id))
        .orderBy(worldSnapshots.sequenceNum);

      const buildSnapshots = async (rows: typeof r1Rows): Promise<MerkleSnapshot[]> => {
        return Promise.all(
          rows.map(async (row) => {
            const comps = await db
              .select()
              .from(snapshotComponents)
              .where(eq(snapshotComponents.snapshotId, row.id));

            return {
              id: row.id,
              worldId: row.worldId,
              simTimeMicros: row.simTimeMicros,
              sequenceNum: row.sequenceNum,
              merkleRootHash: row.merkleRootHash,
              snapshotType: row.snapshotType as MerkleSnapshot['snapshotType'],
              totalComponents: row.totalComponents,
              deduplicatedComponents: row.deduplicatedComponents,
              sizeBytes: row.sizeBytes,
              components: comps.map((c) => ({
                componentType: c.componentType as ComponentSnapshot['componentType'],
                componentId: c.componentId,
                componentHash: c.componentHash,
                payload: c.statePayload,
                isDeduplicated: c.isDeduplicated,
              })),
            };
          }),
        );
      };

      const [run1Snaps, run2Snaps] = await Promise.all([
        buildSnapshots(r1Rows),
        buildSnapshots(r2Rows),
      ]);

      const diff = CheckpointBisector.findDivergence(run1Snaps, run2Snaps);
      return { data: diff };
    },
  );

  // 5. Run Disaster Recovery Drill
  fastify.post(
    '/worlds/:worldId/recovery/dr/drill',
    {
      preHandler: [fastify.requirePermission('topology:write')],
    },
    async (req, reply) => {
      const params = req.params as { worldId: string };
      const body = drDrillSchema.parse(req.body);

      const [snapshotRow] = await db
        .select()
        .from(worldSnapshots)
        .where(
          and(
            eq(worldSnapshots.id, body.snapshotId),
            eq(worldSnapshots.worldId, params.worldId),
          ),
        );

      if (!snapshotRow) {
        throw AppError.notFound('Snapshot', body.snapshotId);
      }

      const compRows = await db
        .select()
        .from(snapshotComponents)
        .where(eq(snapshotComponents.snapshotId, snapshotRow.id));

      const snapshot: MerkleSnapshot = {
        id: snapshotRow.id,
        worldId: snapshotRow.worldId,
        simTimeMicros: snapshotRow.simTimeMicros,
        sequenceNum: snapshotRow.sequenceNum,
        merkleRootHash: snapshotRow.merkleRootHash,
        snapshotType: snapshotRow.snapshotType as MerkleSnapshot['snapshotType'],
        totalComponents: snapshotRow.totalComponents,
        deduplicatedComponents: snapshotRow.deduplicatedComponents,
        sizeBytes: snapshotRow.sizeBytes,
        components: compRows.map((c) => ({
          componentType: c.componentType as ComponentSnapshot['componentType'],
          componentId: c.componentId,
          componentHash: c.componentHash,
          payload: c.statePayload,
          isDeduplicated: c.isDeduplicated,
        })),
      };

      const disasterTime = body.disasterTimeMicros ?? snapshot.simTimeMicros + 500_000;
      const drillResult = DisasterRecoveryCoordinator.executeDrill({
        snapshot,
        disasterTimeMicros: disasterTime,
      });

      // Record in dr_restorations table
      await db.insert(drRestorations).values({
        id: drillResult.restorationId,
        worldId: params.worldId,
        snapshotId: snapshot.id,
        restoreStatus: drillResult.status,
        rpoMicros: drillResult.rpoMicros,
        rtoMs: drillResult.rtoMs,
        verificationHashMatch: drillResult.hashVerified,
        restoredBy: 'system-dr-operator',
      });

      return reply.code(200).send(drillResult);
    },
  );

  // 6. DR History
  fastify.get(
    '/worlds/:worldId/recovery/dr/history',
    {
      preHandler: [fastify.requirePermission('topology:read')],
    },
    async (req) => {
      const params = req.params as { worldId: string };
      const drills = await db
        .select()
        .from(drRestorations)
        .where(eq(drRestorations.worldId, params.worldId))
        .orderBy(desc(drRestorations.createdAt));

      return { data: drills };
    },
  );
}
