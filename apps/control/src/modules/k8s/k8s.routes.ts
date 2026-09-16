import type { FastifyInstance } from 'fastify';
import { eq, and, desc } from 'drizzle-orm';
import {
  db,
  worlds,
  services,
  serviceDependencies,
  k8sDeployments,
  k8sChaosEvents,
} from '@mirrorgrid/db';
import {
  ManifestGenerator,
  HaValidator,
  type TopologyServiceNode,
  type TopologyDependencyEdge,
} from '@mirrorgrid/k8s';
import { AppError } from '@mirrorgrid/platform';
import { z } from 'zod';
import { globalNamespaceManager, getOrCreateDefaultCluster } from './k8s.service.js';

const deployWorldSchema = z.object({
  replicasPerService: z.number().int().min(1).max(10).optional().default(3),
  enableNetworkPolicies: z.boolean().optional().default(true),
  namespacePrefix: z.string().optional().default('mg-world'),
  services: z
    .array(
      z.object({
        id: z.string().optional(),
        name: z.string(),
        replicas: z.number().optional(),
        image: z.string().optional(),
        port: z.number().optional(),
      }),
    )
    .optional(),
  dependencies: z
    .array(
      z.object({
        sourceServiceName: z.string(),
        targetServiceName: z.string(),
      }),
    )
    .optional(),
});

const podKillSchema = z.object({
  serviceName: z.string().optional(),
  trafficRps: z.number().int().positive().optional().default(200),
  testDurationSeconds: z.number().int().positive().optional().default(2),
});

const rollingUpdateSchema = z.object({
  serviceName: z.string().optional(),
  newImageTag: z.string().optional().default('mirrorgrid/synthetic-service:v2'),
  trafficRps: z.number().int().positive().optional().default(200),
});

export async function k8sRoutes(fastify: FastifyInstance) {
  // 1. Deploy World to Kubernetes
  fastify.post(
    '/worlds/:worldId/k8s/deploy',
    {
      preHandler: [fastify.requirePermission('topology:write')],
    },
    async (req, reply) => {
      const params = req.params as { worldId: string };
      const body = deployWorldSchema.parse(req.body ?? {});

      const world = await db.query.worlds.findFirst({
        where: eq(worlds.id, params.worldId),
      });
      if (!world) {
        throw AppError.notFound(`World ${params.worldId} not found`);
      }

      const cluster = await getOrCreateDefaultCluster();

      // Resolve services
      let serviceNodes: TopologyServiceNode[] = [];
      if (body.services && body.services.length > 0) {
        serviceNodes = body.services.map((s, idx) => ({
          id: s.id ?? `svc-${idx}`,
          name: s.name,
          replicas: s.replicas ?? body.replicasPerService,
          image: s.image,
          port: s.port ?? 8080,
        }));
      } else {
        const dbSvcs = await db.query.services.findMany({
          where: eq(services.worldId, params.worldId),
        });
        if (dbSvcs.length === 0) {
          throw AppError.badRequest('No services found for world. Seed services or specify them in request.');
        }
        serviceNodes = dbSvcs.map((s) => ({
          id: s.id,
          name: s.name,
          replicas: body.replicasPerService,
          port: 8080,
        }));
      }

      // Resolve dependencies
      let dependencyEdges: TopologyDependencyEdge[] = [];
      if (body.dependencies && body.dependencies.length > 0) {
        dependencyEdges = body.dependencies;
      } else {
        const dbDeps = await db.query.serviceDependencies.findMany({
          where: eq(serviceDependencies.worldId, params.worldId),
        });
        const svcMap = new Map<string, string>();
        for (const s of serviceNodes) {
          svcMap.set(s.id, s.name);
        }
        dependencyEdges = dbDeps.map((d) => ({
          sourceServiceName: svcMap.get(d.sourceServiceId) ?? d.sourceServiceId,
          targetServiceName: svcMap.get(d.targetServiceId) ?? d.targetServiceId,
        }));
      }

      // Compile manifests
      const bundle = ManifestGenerator.compileWorld({
        worldId: params.worldId,
        services: serviceNodes,
        dependencies: dependencyEdges,
        namespacePrefix: body.namespacePrefix,
        replicasPerService: body.replicasPerService,
        enableNetworkPolicies: body.enableNetworkPolicies,
      });

      // Validate manifests against OpenAPI schemas
      for (const dep of bundle.deployments) {
        const val = ManifestGenerator.validateSchema(dep);
        if (!val.valid) {
          throw AppError.badRequest(`Deployment validation error: ${val.errors.join(', ')}`);
        }
      }
      for (const svc of bundle.services) {
        const val = ManifestGenerator.validateSchema(svc);
        if (!val.valid) {
          throw AppError.badRequest(`Service validation error: ${val.errors.join(', ')}`);
        }
      }
      for (const np of bundle.networkPolicies) {
        const val = ManifestGenerator.validateSchema(np);
        if (!val.valid) {
          throw AppError.badRequest(`NetworkPolicy validation error: ${val.errors.join(', ')}`);
        }
      }

      // Clean up any existing namespace with this name
      globalNamespaceManager.deleteNamespace(bundle.namespace);
      globalNamespaceManager.createNamespace(bundle.namespace);

      let totalPods = 0;
      for (const svc of serviceNodes) {
        const count = svc.replicas ?? body.replicasPerService ?? 3;
        globalNamespaceManager.provisionPods(bundle.namespace, svc.name, count);
        totalPods += count;
      }

      const deploymentId = crypto.randomUUID();
      await db.insert(k8sDeployments).values({
        id: deploymentId,
        worldId: params.worldId,
        clusterId: cluster.id,
        namespace: bundle.namespace,
        status: 'RUNNING',
        totalDeployments: bundle.deployments.length,
        totalPods,
        healthyPods: totalPods,
        deployedAt: new Date(),
      });

      const activePods = globalNamespaceManager.getPods(bundle.namespace);

      return reply.status(201).send({
        success: true,
        data: {
          deploymentId,
          namespace: bundle.namespace,
          manifestBundle: bundle,
          totalDeployments: bundle.deployments.length,
          totalPods,
          healthyPods: totalPods,
          allPodsReady: activePods.every((p) => p.ready),
          pods: activePods,
        },
      });
    },
  );

  // 2. Get World Kubernetes Status
  fastify.get(
    '/worlds/:worldId/k8s/status',
    {
      preHandler: [fastify.requirePermission('topology:read')],
    },
    async (req, reply) => {
      const params = req.params as { worldId: string };

      const deployment = await db.query.k8sDeployments.findFirst({
        where: and(
          eq(k8sDeployments.worldId, params.worldId),
          eq(k8sDeployments.status, 'RUNNING'),
        ),
        orderBy: [desc(k8sDeployments.deployedAt)],
      });

      if (!deployment) {
        throw AppError.notFound(`No running Kubernetes deployment found for world ${params.worldId}`);
      }

      const pods = globalNamespaceManager.getPods(deployment.namespace);
      const healthyPods = pods.filter((p) => p.ready).length;

      return reply.send({
        success: true,
        data: {
          deployment,
          totalPods: pods.length,
          healthyPods,
          allPodsReady: pods.length > 0 && healthyPods === pods.length,
          pods,
        },
      });
    },
  );

  // 3. Chaos: Pod Kill under load
  fastify.post(
    '/worlds/:worldId/k8s/chaos/pod-kill',
    {
      preHandler: [fastify.requirePermission('topology:write')],
    },
    async (req, reply) => {
      const params = req.params as { worldId: string };
      const body = podKillSchema.parse(req.body ?? {});

      const deployment = await db.query.k8sDeployments.findFirst({
        where: and(
          eq(k8sDeployments.worldId, params.worldId),
          eq(k8sDeployments.status, 'RUNNING'),
        ),
        orderBy: [desc(k8sDeployments.deployedAt)],
      });

      if (!deployment) {
        throw AppError.notFound(`No running Kubernetes deployment found for world ${params.worldId}`);
      }

      const activePods = globalNamespaceManager.getPods(deployment.namespace);
      if (activePods.length === 0) {
        throw AppError.badRequest('No pods currently provisioned in deployment namespace');
      }

      const targetServiceName = body.serviceName ?? activePods[0]!.serviceName;

      const result = await HaValidator.validatePodTermination({
        manager: globalNamespaceManager,
        namespace: deployment.namespace,
        serviceName: targetServiceName,
        trafficRps: body.trafficRps,
        testDurationSeconds: body.testDurationSeconds,
      });

      const eventId = crypto.randomUUID();
      await db.insert(k8sChaosEvents).values({
        id: eventId,
        deploymentId: deployment.id,
        chaosType: 'POD_KILL',
        targetServiceName,
        targetPodName: `${targetServiceName}-victim`,
        trafficOfferedRps: result.totalRequests,
        requestsSuccessful: result.successfulRequests,
        requestsFailed: result.failedRequests,
        availabilityPercentage: result.availabilityPercentage,
        startedAt: new Date(),
        completedAt: new Date(),
        status: 'COMPLETED',
      });

      return reply.send({
        success: true,
        data: {
          eventId,
          testResult: result,
        },
      });
    },
  );

  // 4. Chaos: Rolling Update under load
  fastify.post(
    '/worlds/:worldId/k8s/chaos/rolling-update',
    {
      preHandler: [fastify.requirePermission('topology:write')],
    },
    async (req, reply) => {
      const params = req.params as { worldId: string };
      const body = rollingUpdateSchema.parse(req.body ?? {});

      const deployment = await db.query.k8sDeployments.findFirst({
        where: and(
          eq(k8sDeployments.worldId, params.worldId),
          eq(k8sDeployments.status, 'RUNNING'),
        ),
        orderBy: [desc(k8sDeployments.deployedAt)],
      });

      if (!deployment) {
        throw AppError.notFound(`No running Kubernetes deployment found for world ${params.worldId}`);
      }

      const activePods = globalNamespaceManager.getPods(deployment.namespace);
      if (activePods.length === 0) {
        throw AppError.badRequest('No pods currently provisioned in deployment namespace');
      }

      const targetServiceName = body.serviceName ?? activePods[0]!.serviceName;

      const result = await HaValidator.validateRollingDeploy({
        manager: globalNamespaceManager,
        namespace: deployment.namespace,
        serviceName: targetServiceName,
        newImageTag: body.newImageTag,
        trafficRps: body.trafficRps,
      });

      const eventId = crypto.randomUUID();
      await db.insert(k8sChaosEvents).values({
        id: eventId,
        deploymentId: deployment.id,
        chaosType: 'ROLLING_UPDATE',
        targetServiceName,
        targetPodName: `${targetServiceName}-rolling`,
        trafficOfferedRps: result.totalRequests,
        requestsSuccessful: result.successfulRequests,
        requestsFailed: result.failedRequests,
        availabilityPercentage: result.availabilityPercentage,
        startedAt: new Date(),
        completedAt: new Date(),
        status: 'COMPLETED',
      });

      return reply.send({
        success: true,
        data: {
          eventId,
          testResult: result,
        },
      });
    },
  );

  // 5. Teardown Kubernetes Deployment and purge namespace
  fastify.delete(
    '/worlds/:worldId/k8s/teardown',
    {
      preHandler: [fastify.requirePermission('topology:write')],
    },
    async (req, reply) => {
      const params = req.params as { worldId: string };

      const deployment = await db.query.k8sDeployments.findFirst({
        where: and(
          eq(k8sDeployments.worldId, params.worldId),
          eq(k8sDeployments.status, 'RUNNING'),
        ),
        orderBy: [desc(k8sDeployments.deployedAt)],
      });

      if (!deployment) {
        throw AppError.notFound(`No running Kubernetes deployment found for world ${params.worldId}`);
      }

      const purgeResult = globalNamespaceManager.deleteNamespace(deployment.namespace);

      await db
        .update(k8sDeployments)
        .set({
          status: 'TERMINATED',
          terminatedAt: new Date(),
          healthyPods: 0,
        })
        .where(eq(k8sDeployments.id, deployment.id));

      return reply.send({
        success: true,
        data: {
          deploymentId: deployment.id,
          namespace: deployment.namespace,
          purgedPodCount: purgeResult.purgedPodCount,
          namespaceCleanlyDeleted: globalNamespaceManager.isNamespaceCleanlyDeleted(deployment.namespace),
        },
      });
    },
  );
}
