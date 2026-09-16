import { eq } from 'drizzle-orm';
import { db } from '@mirrorgrid/db';
import { users, userRoles, roles as rolesTable, sessions } from '@mirrorgrid/db/schema';
import { AppError } from '@mirrorgrid/platform';
import { auditLogger, sessionStore, type RoleCode, type UserPrincipal } from '@mirrorgrid/security';

export class UserService {
  public async listUsers() {
    const allUsers = await db.select().from(users);

    const userList = await Promise.all(
      allUsers.map(async (u) => {
        const assignedRoles = await db
          .select({ roleId: userRoles.roleId })
          .from(userRoles)
          .where(eq(userRoles.userId, u.id));

        const roleCodes = assignedRoles.map((r) => r.roleId as RoleCode);
        if (roleCodes.length === 0) {
          roleCodes.push('VIEWER');
        }

        const activeSessions = await db.select().from(sessions).where(eq(sessions.userId, u.id));

        return {
          id: u.id,
          email: u.email,
          displayName: u.displayName,
          roles: roleCodes,
          createdAt: u.createdAt,
          activeSessionsCount: activeSessions.filter((s) => s.isActive).length,
        };
      }),
    );

    return userList;
  }

  public async assignRoles(
    targetUserId: string,
    newRoles: RoleCode[],
    actingPrincipal: UserPrincipal,
  ) {
    const [targetUser] = await db.select().from(users).where(eq(users.id, targetUserId)).limit(1);

    if (!targetUser) {
      throw AppError.notFound('User', targetUserId);
    }

    // Fetch existing roles for audit diff
    const existingRoleRows = await db
      .select({ roleId: userRoles.roleId })
      .from(userRoles)
      .where(eq(userRoles.userId, targetUserId));
    const previousRoles = existingRoleRows.map((r) => r.roleId);

    // Validate that all role codes exist in roles table
    for (const r of newRoles) {
      const [roleRecord] = await db.select().from(rolesTable).where(eq(rolesTable.id, r)).limit(1);
      if (!roleRecord) {
        throw AppError.badRequest(`Invalid role code: ${r}`);
      }
    }

    // Delete existing and insert new roles
    await db.delete(userRoles).where(eq(userRoles.userId, targetUserId));

    for (const r of newRoles) {
      await db.insert(userRoles).values({
        userId: targetUserId,
        roleId: r,
      });
    }

    // Invalidate session cache for target user so permissions update immediately
    sessionStore.clearCache();

    // Log to cryptographic audit ledger
    await auditLogger.log({
      principal: actingPrincipal,
      action: 'USER_ROLES_UPDATED',
      resourceType: 'USER',
      resourceId: targetUserId,
      diff: {
        before: { roles: previousRoles },
        after: { roles: newRoles },
      },
    });

    return {
      userId: targetUserId,
      roles: newRoles,
    };
  }
}

export const userService = new UserService();
