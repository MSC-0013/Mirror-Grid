import { buildDeploymentSpec } from './deployment-spec.js';
import { buildServiceSpec } from './service-spec.js';
import { buildNetworkPolicySpec } from './netpol-spec.js';

export interface TopologyServiceNode {
  readonly id: string;
  readonly name: string;
  readonly replicas?: number;
  readonly image?: string;
  readonly port?: number;
}

export interface TopologyDependencyEdge {
  readonly sourceServiceName: string;
  readonly targetServiceName: string;
}

export interface K8sManifestBundle {
  readonly namespace: string;
  readonly namespaceSpec: Record<string, unknown>;
  readonly deployments: readonly Record<string, unknown>[];
  readonly services: readonly Record<string, unknown>[];
  readonly networkPolicies: readonly Record<string, unknown>[];
}

export class ManifestGenerator {
  /**
   * Compiles a MIRRORGRID World topology into a fully compliant Kubernetes manifest bundle.
   */
  static compileWorld(params: {
    worldId: string;
    services: readonly TopologyServiceNode[];
    dependencies: readonly TopologyDependencyEdge[];
    namespacePrefix?: string;
    replicasPerService?: number;
    enableNetworkPolicies?: boolean;
  }): K8sManifestBundle {
    const namespace = `${params.namespacePrefix ?? 'mg-world'}-${params.worldId}`;

    // 1. Namespace specification
    const namespaceSpec: Record<string, unknown> = {
      apiVersion: 'v1',
      kind: 'Namespace',
      metadata: {
        name: namespace,
        labels: {
          'mirrorgrid.io/world': params.worldId,
          'mirrorgrid.io/managed-by': 'mirrorgrid-k8s',
        },
      },
    };

    // 2. Deployments and Services
    const deployments: Record<string, unknown>[] = [];
    const servicesList: Record<string, unknown>[] = [];

    for (const svc of params.services) {
      deployments.push(
        buildDeploymentSpec({
          serviceName: svc.name,
          namespace,
          worldId: params.worldId,
          replicas: svc.replicas ?? params.replicasPerService ?? 3,
          image: svc.image,
          port: svc.port ?? 8080,
        }),
      );

      servicesList.push(
        buildServiceSpec({
          serviceName: svc.name,
          namespace,
          worldId: params.worldId,
          port: 80,
          targetPort: svc.port ?? 8080,
        }),
      );
    }

    // 3. NetworkPolicies
    const networkPolicies: Record<string, unknown>[] = [];
    if (params.enableNetworkPolicies !== false) {
      // Group incoming edges per target service
      const incomingEdges = new Map<string, string[]>();
      for (const svc of params.services) {
        incomingEdges.set(svc.name, []);
      }
      for (const edge of params.dependencies) {
        const list = incomingEdges.get(edge.targetServiceName) ?? [];
        list.push(edge.sourceServiceName);
        incomingEdges.set(edge.targetServiceName, list);
      }

      for (const [targetSvc, sources] of incomingEdges.entries()) {
        networkPolicies.push(
          buildNetworkPolicySpec({
            targetService: targetSvc,
            namespace,
            worldId: params.worldId,
            allowedSourceServices: sources,
          }),
        );
      }
    }

    return {
      namespace,
      namespaceSpec,
      deployments,
      services: servicesList,
      networkPolicies,
    };
  }

  /**
   * Validates a Kubernetes manifest against OpenAPI v1 schema rules.
   */
  static validateSchema(manifest: Record<string, unknown>): { valid: boolean; errors: string[] } {
    const errors: string[] = [];

    if (typeof manifest['apiVersion'] !== 'string' || manifest['apiVersion'].length === 0) {
      errors.push("Missing or invalid 'apiVersion'");
    }

    if (typeof manifest['kind'] !== 'string' || manifest['kind'].length === 0) {
      errors.push("Missing or invalid 'kind'");
    }

    const metadata = manifest['metadata'] as Record<string, unknown> | undefined;
    if (!metadata || typeof metadata !== 'object') {
      errors.push("Missing or invalid 'metadata'");
    } else {
      if (typeof metadata['name'] !== 'string' || metadata['name'].length === 0) {
        errors.push("Missing 'metadata.name'");
      }
    }

    const kind = manifest['kind'];
    const spec = manifest['spec'] as Record<string, unknown> | undefined;

    if (kind === 'Deployment') {
      if (!spec) {
        errors.push("Deployment missing 'spec'");
      } else {
        if (typeof spec['replicas'] !== 'number' || (spec['replicas'] as number) < 0) {
          errors.push("Deployment 'spec.replicas' must be a non-negative number");
        }
        if (!spec['selector']) {
          errors.push("Deployment missing 'spec.selector'");
        }
        const template = spec['template'] as Record<string, unknown> | undefined;
        if (!template || !template['spec']) {
          errors.push("Deployment missing 'spec.template.spec'");
        }
      }
    } else if (kind === 'Service') {
      if (!spec) {
        errors.push("Service missing 'spec'");
      } else {
        if (!Array.isArray(spec['ports']) || spec['ports'].length === 0) {
          errors.push("Service 'spec.ports' must be a non-empty array");
        }
      }
    } else if (kind === 'NetworkPolicy') {
      if (!spec) {
        errors.push("NetworkPolicy missing 'spec'");
      } else {
        if (!spec['podSelector']) {
          errors.push("NetworkPolicy missing 'spec.podSelector'");
        }
      }
    }

    return {
      valid: errors.length === 0,
      errors,
    };
  }
}
