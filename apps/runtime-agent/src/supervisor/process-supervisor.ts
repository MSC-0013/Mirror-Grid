import {
  createSyntheticService,
  type SyntheticInstance,
  type SyntheticRouteConfig,
} from '@mirrorgrid/synthetic-service';
import { PortAllocator } from '../ports/port-allocator.js';
import { UserSpaceToxiProxy, type ToxicConfig } from '../proxy/toxi-proxy.js';
import { HealthMonitor } from './health-monitor.js';

export interface SupervisedInstance {
  serviceId: string;
  serviceName: string;
  servicePort: number;
  adminPort: number;
  status: 'STARTING' | 'HEALTHY' | 'UNHEALTHY' | 'STOPPED';
  instance: SyntheticInstance;
}

export class ProcessSupervisor {
  private readonly instances = new Map<string, SupervisedInstance>();
  private readonly proxies = new Map<string, UserSpaceToxiProxy>();
  private readonly portAllocator = new PortAllocator();
  private readonly healthMonitor = new HealthMonitor();

  public async startService(
    serviceId: string,
    serviceName: string,
    routes: SyntheticRouteConfig[] = [],
  ): Promise<SupervisedInstance> {
    const { servicePort, adminPort } = await this.portAllocator.allocatePortPair();

    const instance = await createSyntheticService({
      serviceId,
      serviceName,
      servicePort,
      initialRoutes: routes,
    });

    const isHealthy = await this.healthMonitor.waitForHealthy(servicePort, 10_000);

    const supervised: SupervisedInstance = {
      serviceId,
      serviceName,
      servicePort,
      adminPort,
      status: isHealthy ? 'HEALTHY' : 'UNHEALTHY',
      instance,
    };

    this.instances.set(serviceId, supervised);
    return supervised;
  }

  public async createEdgeProxy(
    edgeId: string,
    targetServiceId: string,
  ): Promise<UserSpaceToxiProxy> {
    const target = this.instances.get(targetServiceId);
    if (!target) {
      throw new Error(`Target service ${targetServiceId} not found`);
    }

    const proxyPort = await this.portAllocator.allocatePort();
    const proxy = new UserSpaceToxiProxy(proxyPort, '127.0.0.1', target.servicePort);
    await proxy.start();

    this.proxies.set(edgeId, proxy);
    return proxy;
  }

  public getProxy(edgeId: string): UserSpaceToxiProxy | undefined {
    return this.proxies.get(edgeId);
  }

  public applyToxic(edgeId: string, toxic: ToxicConfig): void {
    const proxy = this.proxies.get(edgeId);
    if (proxy) {
      proxy.addToxic(toxic);
    }
  }

  public clearToxics(edgeId: string): void {
    const proxy = this.proxies.get(edgeId);
    if (proxy) {
      proxy.clearToxics();
    }
  }

  public getInstances(): SupervisedInstance[] {
    return Array.from(this.instances.values());
  }

  public getInstance(serviceId: string): SupervisedInstance | undefined {
    return this.instances.get(serviceId);
  }

  public async stopAll(): Promise<void> {
    for (const proxy of this.proxies.values()) {
      await proxy.stop().catch(() => {});
    }
    this.proxies.clear();

    for (const sup of this.instances.values()) {
      await sup.instance.stop().catch(() => {});
    }
    this.instances.clear();
    this.portAllocator.releaseAll();
  }
}
