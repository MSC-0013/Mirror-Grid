import assert from 'node:assert';
import { authorizer, getPermissionsForRoles, type UserPrincipal } from '../../src/index.js';

export async function testAuthorizer() {
  console.log('Testing RBAC Authorizer matrix...');

  const viewer: UserPrincipal = {
    id: 'user-viewer',
    email: 'viewer@mirrorgrid.io',
    displayName: 'Alice Viewer',
    roles: ['VIEWER'],
    permissions: getPermissionsForRoles(['VIEWER']),
    sessionId: 'sess-01',
  };

  const operator: UserPrincipal = {
    id: 'user-operator',
    email: 'operator@mirrorgrid.io',
    displayName: 'Bob Operator',
    roles: ['OPERATOR'],
    permissions: getPermissionsForRoles(['OPERATOR']),
    sessionId: 'sess-02',
  };

  const admin: UserPrincipal = {
    id: 'user-admin',
    email: 'admin@mirrorgrid.io',
    displayName: 'Charlie Admin',
    roles: ['ADMIN'],
    permissions: getPermissionsForRoles(['ADMIN']),
    sessionId: 'sess-03',
  };

  // Viewer tests
  assert(authorizer.hasPermission(viewer, 'topology:read'));
  assert(authorizer.hasPermission(viewer, 'experiments:read'));
  assert(!authorizer.hasPermission(viewer, 'topology:write'));
  assert(!authorizer.hasPermission(viewer, 'faults:inject'));
  assert(!authorizer.hasPermission(viewer, 'chaos:abort'));
  assert(!authorizer.hasPermission(viewer, 'audit:read'));
  assert(!authorizer.hasPermission(viewer, 'users:manage'));

  // Operator tests
  assert(authorizer.hasPermission(operator, 'topology:read'));
  assert(authorizer.hasPermission(operator, 'topology:write'));
  assert(authorizer.hasPermission(operator, 'faults:inject'));
  assert(authorizer.hasPermission(operator, 'chaos:abort'));
  assert(!authorizer.hasPermission(operator, 'audit:read'));
  assert(!authorizer.hasPermission(operator, 'users:manage'));

  // Admin tests
  assert(authorizer.hasPermission(admin, 'topology:read'));
  assert(authorizer.hasPermission(admin, 'topology:write'));
  assert(authorizer.hasPermission(admin, 'faults:inject'));
  assert(authorizer.hasPermission(admin, 'chaos:abort'));
  assert(authorizer.hasPermission(admin, 'audit:read'));
  assert(authorizer.hasPermission(admin, 'users:manage'));

  console.log('✓ RBAC permissions matrix strictly verified across VIEWER, OPERATOR, and ADMIN.');
}
