import { AppError } from '@mirrorgrid/platform';
import type { PermissionCode, RoleCode, UserPrincipal } from './permissions.js';

export interface Authorizer {
  hasPermission(principal: UserPrincipal, required: PermissionCode): boolean;
  hasRole(principal: UserPrincipal, role: RoleCode): boolean;
  assertPermission(principal: UserPrincipal, required: PermissionCode): void;
  assertRole(principal: UserPrincipal, role: RoleCode): void;
}

export class DefaultAuthorizer implements Authorizer {
  public hasPermission(principal: UserPrincipal, required: PermissionCode): boolean {
    return principal.permissions.has(required);
  }

  public hasRole(principal: UserPrincipal, role: RoleCode): boolean {
    return principal.roles.includes(role);
  }

  public assertPermission(principal: UserPrincipal, required: PermissionCode): void {
    if (!this.hasPermission(principal, required)) {
      throw AppError.forbidden(`Access denied: requires permission '${required}'`);
    }
  }

  public assertRole(principal: UserPrincipal, role: RoleCode): void {
    if (!this.hasRole(principal, role)) {
      throw AppError.forbidden(`Access denied: requires role '${role}'`);
    }
  }
}

export const authorizer = new DefaultAuthorizer();
