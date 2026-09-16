export interface ServiceSpecOptions {
  readonly serviceName: string;
  readonly namespace: string;
  readonly worldId: string;
  readonly port?: number;
  readonly targetPort?: number;
}

export function buildServiceSpec(options: ServiceSpecOptions): Record<string, unknown> {
  const port = options.port ?? 80;
  const targetPort = options.targetPort ?? 8080;

  return {
    apiVersion: 'v1',
    kind: 'Service',
    metadata: {
      name: options.serviceName,
      namespace: options.namespace,
      labels: {
        app: options.serviceName,
        'mirrorgrid.io/world': options.worldId,
      },
    },
    spec: {
      type: 'ClusterIP',
      selector: {
        app: options.serviceName,
      },
      ports: [
        {
          name: 'http',
          port,
          targetPort,
          protocol: 'TCP',
        },
      ],
    },
  };
}
