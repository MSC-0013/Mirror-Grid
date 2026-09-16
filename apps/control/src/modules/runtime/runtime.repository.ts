import { eq } from 'drizzle-orm';
import { db, schema } from '@mirrorgrid/db';

export class RuntimeRepository {
  public async createDeployment(worldId: string, runtimeMode: string) {
    const [row] = await db
      .insert(schema.runtimeDeployments)
      .values({
        worldId,
        runtimeMode,
        status: 'RUNNING',
      })
      .returning();
    return row;
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
    const [row] = await db
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
      .onConflictDoUpdate({
        target: [schema.containerInstances.deploymentId, schema.containerInstances.serviceId],
        set: {
          status: 'HEALTHY',
          servicePort,
          adminPort,
          startedAt: new Date(),
        },
      })
      .returning();
    return row;
  }

  public async getContainersByDeployment(deploymentId: string) {
    return db
      .select()
      .from(schema.containerInstances)
      .where(eq(schema.containerInstances.deploymentId, deploymentId));
  }

  public async updateContainerStatus(id: string, status: string) {
    const [row] = await db
      .update(schema.containerInstances)
      .set({ status })
      .where(eq(schema.containerInstances.id, id))
      .returning();
    return row;
  }

  public async updateDeploymentStatus(id: string, status: string, error?: string) {
    const [row] = await db
      .update(schema.runtimeDeployments)
      .set({
        status,
        errorMessage: error,
        terminatedAt: status === 'STOPPED' ? new Date() : undefined,
      })
      .where(eq(schema.runtimeDeployments.id, id))
      .returning();
    return row;
  }
}
