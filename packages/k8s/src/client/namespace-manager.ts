export interface ManagedPod {
  readonly id: string;
  readonly name: string;
  readonly serviceName: string;
  readonly namespace: string;
  readonly nodeName: string;
  readonly ipAddress: string;
  status: 'Pending' | 'ContainerCreating' | 'Running' | 'Terminating' | 'Terminated';
  ready: boolean;
  restartCount: number;
}

export class NamespaceManager {
  private readonly namespaces = new Set<string>();
  private readonly pods = new Map<string, ManagedPod[]>(); // namespace -> pods

  createNamespace(name: string): boolean {
    if (this.namespaces.has(name)) return false;
    this.namespaces.add(name);
    this.pods.set(name, []);
    return true;
  }

  deleteNamespace(name: string): { deleted: boolean; purgedPodCount: number } {
    if (!this.namespaces.has(name)) {
      return { deleted: false, purgedPodCount: 0 };
    }

    const podList = this.pods.get(name) ?? [];
    const count = podList.length;

    // Cascade purge all resources cleanly
    this.pods.delete(name);
    this.namespaces.delete(name);

    return { deleted: true, purgedPodCount: count };
  }

  provisionPods(namespace: string, serviceName: string, replicaCount: number): ManagedPod[] {
    if (!this.namespaces.has(namespace)) {
      this.createNamespace(namespace);
    }

    const currentList = this.pods.get(namespace) ?? [];
    const newPods: ManagedPod[] = [];

    for (let i = 1; i <= replicaCount; i++) {
      const randomSuffix = Math.random().toString(36).substring(2, 7);
      const pod: ManagedPod = {
        id: crypto.randomUUID(),
        name: `${serviceName}-${randomSuffix}`,
        serviceName,
        namespace,
        nodeName: `worker-node-${(i % 3) + 1}`,
        ipAddress: `10.244.${(i % 3) + 1}.${10 + i}`,
        status: 'Running',
        ready: true,
        restartCount: 0,
      };
      newPods.push(pod);
      currentList.push(pod);
    }

    this.pods.set(namespace, currentList);
    return newPods;
  }

  getPods(namespace: string): ManagedPod[] {
    return this.pods.get(namespace) ?? [];
  }

  isNamespaceCleanlyDeleted(name: string): boolean {
    return !this.namespaces.has(name) && (!this.pods.has(name) || this.pods.get(name)!.length === 0);
  }
}
