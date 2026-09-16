export interface DeploymentSpecOptions {
  readonly serviceName: string;
  readonly namespace: string;
  readonly worldId: string;
  readonly replicas?: number;
  readonly image?: string;
  readonly port?: number;
  readonly preStopSeconds?: number;
}

export function buildDeploymentSpec(options: DeploymentSpecOptions): Record<string, unknown> {
  const replicas = options.replicas ?? 3;
  const image = options.image ?? 'mirrorgrid/synthetic-service:latest';
  const port = options.port ?? 8080;
  const preStopSeconds = options.preStopSeconds ?? 5;

  return {
    apiVersion: 'apps/v1',
    kind: 'Deployment',
    metadata: {
      name: options.serviceName,
      namespace: options.namespace,
      labels: {
        app: options.serviceName,
        'mirrorgrid.io/world': options.worldId,
        'mirrorgrid.io/managed-by': 'mirrorgrid-k8s',
      },
    },
    spec: {
      replicas,
      strategy: {
        type: 'RollingUpdate',
        rollingUpdate: {
          maxSurge: 1,
          maxUnavailable: 0, // Zero downtime guarantee
        },
      },
      selector: {
        matchLabels: {
          app: options.serviceName,
        },
      },
      template: {
        metadata: {
          labels: {
            app: options.serviceName,
            'mirrorgrid.io/world': options.worldId,
          },
        },
        spec: {
          terminationGracePeriodSeconds: preStopSeconds + 15,
          containers: [
            {
              name: options.serviceName,
              image,
              imagePullPolicy: 'IfNotPresent',
              ports: [
                {
                  name: 'http',
                  containerPort: port,
                  protocol: 'TCP',
                },
              ],
              lifecycle: {
                preStop: {
                  exec: {
                    command: ['sleep', preStopSeconds.toString()],
                  },
                },
              },
              readinessProbe: {
                httpGet: {
                  path: '/health/readiness',
                  port,
                },
                initialDelaySeconds: 1,
                periodSeconds: 1,
                timeoutSeconds: 1,
                successThreshold: 1,
                failureThreshold: 2,
              },
              livenessProbe: {
                httpGet: {
                  path: '/health/liveness',
                  port,
                },
                initialDelaySeconds: 3,
                periodSeconds: 3,
                timeoutSeconds: 1,
                failureThreshold: 3,
              },
              resources: {
                requests: {
                  cpu: '100m',
                  memory: '128Mi',
                },
                limits: {
                  cpu: '500m',
                  memory: '256Mi',
                },
              },
            },
          ],
        },
      },
    },
  };
}
