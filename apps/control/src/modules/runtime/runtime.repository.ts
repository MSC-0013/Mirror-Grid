import { eq, and } from 'drizzle-orm';
import { db, schema, insertReturning, updateReturning } from '@mirrorgrid/db';

export class RuntimeRepository {
  public async createDeployment(worldId: string, runtimeMode: string) {
    return insertReturning(schema.runtimeDeployments, {
      worldId,
      runtimeMode,
      status: 'RUNNING',
    });
  }

  public async getLatestDeployment(worldId: string) {
    const [row] = await db
      .select()
      .from(schema.runtimeDeployments)
      .where(eq(schema.runtimeDeployments.worldId, worldId))
      .orderBy(schema.runtimeDeployments.deployedAt)
      .limit(1);
    return row || null;
  }

  public async recordContainerInstance(
    worldId: string,
    deploymentId: string,
    serviceId: string,
    dockerContainerId: string,
    servicePort: number,
    adminPort: number,
  ) {
    // Upsert-and-read-back: neither insertReturning() (plain insert) nor
    // updateReturning() (no INSERT branch) covers ON DUPLICATE KEY UPDATE, so this is
    // written directly. Re-selecting by (deploymentId, serviceId) rather than an id is
    // deliberate — on the update branch the pre-existing row's id is not known here, and
    // that pair is exactly what the natural key constraint the upsert relies on.
    await db
      .insert(schema.containerInstances)
      .values({
        worldId,
        deploymentId,
        serviceId,
        dockerContainerId,
        dockerImage: 'mirrorgrid/synthetic-service:latest',
        servicePort,
        adminPort,
        status: 'HEALTHY',
        startedAt: new Date(),
      })
      .onDuplicateKeyUpdate({
        set: {
          status: 'HEALTHY',
          servicePort,
          adminPort,
          startedAt: new Date(),
        },
      });

    const [row] = await db
      .select()
      .from(schema.containerInstances)
      .where(
        and(
          eq(schema.containerInstances.deploymentId, deploymentId),
          eq(schema.containerInstances.serviceId, serviceId),
        ),
      )
      .limit(1);
    return row;
  }

  public async getContainersByDeployment(deploymentId: string) {
    return db
      .select()
      .from(schema.containerInstances)
      .where(eq(schema.containerInstances.deploymentId, deploymentId));
  }

  public async updateContainerStatus(id: string, status: string) {
    return updateReturning(
      schema.containerInstances,
      { status },
      eq(schema.containerInstances.id, id),
    );
  }

  public async updateDeploymentStatus(id: string, status: string, error?: string) {
    return updateReturning(
      schema.runtimeDeployments,
      {
        status,
        errorMessage: error,
        terminatedAt: status === 'STOPPED' ? new Date() : undefined,
      },
      eq(schema.runtimeDeployments.id, id),
    );
  }
}
