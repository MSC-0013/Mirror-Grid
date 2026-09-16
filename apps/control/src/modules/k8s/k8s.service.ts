import { NamespaceManager } from '@mirrorgrid/k8s';
import { db, k8sClusters } from '@mirrorgrid/db';
import { eq } from 'drizzle-orm';

export const globalNamespaceManager = new NamespaceManager();

export async function getOrCreateDefaultCluster(): Promise<{ id: string; name: string }> {
  const existing = await db.query.k8sClusters.findFirst({
    where: eq(k8sClusters.name, 'mirrorgrid-local-k8s'),
  });

  if (existing) {
    return { id: existing.id, name: existing.name };
  }

  const clusterId = crypto.randomUUID();
  await db.insert(k8sClusters).values({
    id: clusterId,
    name: 'mirrorgrid-local-k8s',
    apiServerUrl: 'https://kubernetes.default.svc:443',
    kubeconfigContext: 'kind-mirrorgrid',
    clusterVersion: 'v1.31.0',
    isActive: true,
  });

  return { id: clusterId, name: 'mirrorgrid-local-k8s' };
}
