import type { WorldSpec } from '@mirrorgrid/domain';

export interface HybridRoutingRule {
  serviceId: string;
  targetMode: 'LOGICAL' | 'CONTAINER';
  hostUrl?: string;
}

export class HybridBridge {
  private readonly rules = new Map<string, HybridRoutingRule>();

  public configureRules(
    spec: WorldSpec,
    containerServiceIds: Set<string>,
    containerPorts: Map<string, number>,
  ): void {
    this.rules.clear();

    for (const svc of spec.services) {
      if (containerServiceIds.has(svc.id)) {
        const port = containerPorts.get(svc.id);
        this.rules.set(svc.id, {
          serviceId: svc.id,
          targetMode: 'CONTAINER',
          hostUrl: port ? `http://127.0.0.1:${port}` : undefined,
        });
      } else {
        this.rules.set(svc.id, {
          serviceId: svc.id,
          targetMode: 'LOGICAL',
        });
      }
    }
  }

  public getRule(serviceId: string): HybridRoutingRule | undefined {
    return this.rules.get(serviceId);
  }
}
