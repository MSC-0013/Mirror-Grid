/**
 * RBAC Permission and Role Definitions
 */

export type PermissionCode =
  | 'topology:read'
  | 'topology:write'
  | 'experiments:read'
  | 'experiments:run'
  | 'faults:inject'
  | 'chaos:abort'
  | 'audit:read'
  | 'users:manage';

export type RoleCode = 'ADMIN' | 'OPERATOR' | 'VIEWER';

export interface UserPrincipal {
  readonly id: string;
  readonly email: string;
  readonly displayName: string;
  readonly organizationId?: string;
  readonly roles: readonly RoleCode[];
  readonly permissions: ReadonlySet<PermissionCode>;
  readonly sessionId: string;
}

export const ROLE_PERMISSIONS: Record<RoleCode, readonly PermissionCode[]> = {
  VIEWER: ['topology:read', 'experiments:read'],
  OPERATOR: [
    'topology:read',
    'topology:write',
    'experiments:read',
    'experiments:run',
    'faults:inject',
    'chaos:abort',
  ],
  ADMIN: [
    'topology:read',
    'topology:write',
    'experiments:read',
    'experiments:run',
    'faults:inject',
    'chaos:abort',
    'audit:read',
    'users:manage',
  ],
};

export function getPermissionsForRoles(roles: readonly RoleCode[]): Set<PermissionCode> {
  const set = new Set<PermissionCode>();
  for (const role of roles) {
    const perms = ROLE_PERMISSIONS[role] ?? [];
    for (const p of perms) {
      set.add(p);
    }
  }
  return set;
}
