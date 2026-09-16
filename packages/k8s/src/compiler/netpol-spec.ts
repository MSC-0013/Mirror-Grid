export interface NetworkPolicyOptions {
  readonly targetService: string;
  readonly namespace: string;
  readonly worldId: string;
  readonly allowedSourceServices: readonly string[];
  readonly port?: number;
}

export function buildNetworkPolicySpec(options: NetworkPolicyOptions): Record<string, unknown> {
  const port = options.port ?? 8080;

  const ingressRules = options.allowedSourceServices.map((source) => ({
    from: [
      {
        podSelector: {
          matchLabels: {
            app: source,
          },
        },
      },
    ],
    ports: [
      {
        protocol: 'TCP',
        port,
      },
    ],
  }));

  return {
    apiVersion: 'networking.k8s.io/v1',
    kind: 'NetworkPolicy',
    metadata: {
      name: `netpol-${options.targetService}`,
      namespace: options.namespace,
      labels: {
        app: options.targetService,
        'mirrorgrid.io/world': options.worldId,
      },
    },
    spec: {
      podSelector: {
        matchLabels: {
          app: options.targetService,
        },
      },
      policyTypes: ['Ingress'],
      ingress: ingressRules,
    },
  };
}
