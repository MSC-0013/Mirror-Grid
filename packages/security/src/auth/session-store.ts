import { createHash, randomBytes } from 'node:crypto';
import { eq, and, gt } from 'drizzle-orm';
import { db } from '@mirrorgrid/db';
import { sessions, users, userRoles, organizationMembers } from '@mirrorgrid/db/schema';
import { getPermissionsForRoles, type RoleCode, type UserPrincipal } from '../rbac/permissions.js';

export interface CreateSessionOptions {
  userId: string;
  ipAddress?: string;
  userAgent?: string;
  ttlSeconds?: number;
}

export interface SessionRecord {
  id: string;
  userId: string;
  tokenHash: string;
  expiresAt: Date;
  ipAddress?: string | null;
  userAgent?: string | null;
  isActive: boolean;
}

export interface CachedPrincipalSession {
  principal: UserPrincipal;
  expiresAt: number; // timestamp ms
}

export class SessionStore {
  // In-memory hot cache: tokenHash -> CachedPrincipalSession for sub-millisecond lookup
  private readonly memoryCache = new Map<string, CachedPrincipalSession>();

  public hashToken(token: string): string {
    return createHash('sha256').update(token).digest('hex');
  }

  public generateToken(): string {
    return randomBytes(32).toString('hex');
  }

  public async createSession(options: CreateSessionOptions): Promise<{
    token: string;
    tokenHash: string;
    expiresAt: Date;
    principal: UserPrincipal;
  }> {
    const token = this.generateToken();
    const tokenHash = this.hashToken(token);
    const ttlMs = (options.ttlSeconds ?? 7 * 24 * 60 * 60) * 1000;
    const expiresAt = new Date(Date.now() + ttlMs);

    const [inserted] = await db
      .insert(sessions)
      .values({
        userId: options.userId,
        tokenHash,
        expiresAt,
        ipAddress: options.ipAddress,
        userAgent: options.userAgent,
        isActive: true,
      })
      .returning();

    const principal = await this.resolvePrincipal(options.userId, inserted.id);

    this.memoryCache.set(tokenHash, {
      principal,
      expiresAt: expiresAt.getTime(),
    });

    return {
      token,
      tokenHash,
      expiresAt,
      principal,
    };
  }

  public async validateToken(token: string): Promise<UserPrincipal | null> {
    const tokenHash = this.hashToken(token);
    return this.validateTokenHash(tokenHash);
  }

  public async validateTokenHash(tokenHash: string): Promise<UserPrincipal | null> {
    const nowMs = Date.now();

    // 1. Fast cache check
    const cached = this.memoryCache.get(tokenHash);
    if (cached) {
      if (cached.expiresAt <= nowMs) {
        this.memoryCache.delete(tokenHash);
        return null;
      }
      return cached.principal;
    }

    // 2. Query SQLite
    const now = new Date(nowMs);
    const [row] = await db
      .select({
        session: sessions,
        user: users,
      })
      .from(sessions)
      .innerJoin(users, eq(sessions.userId, users.id))
      .where(
        and(
          eq(sessions.tokenHash, tokenHash),
          eq(sessions.isActive, true),
          gt(sessions.expiresAt, now),
        ),
      )
      .limit(1);

    if (!row) {
      return null;
    }

    const principal = await this.resolvePrincipal(row.user.id, row.session.id);

    this.memoryCache.set(tokenHash, {
      principal,
      expiresAt: row.session.expiresAt.getTime(),
    });

    // Asynchronously touch last seen
    void db
      .update(sessions)
      .set({ lastSeenAt: new Date() })
      .where(eq(sessions.tokenHash, tokenHash))
      .catch(() => {});

    return principal;
  }

  public async revokeToken(token: string): Promise<void> {
    const tokenHash = this.hashToken(token);
    await this.revokeTokenHash(tokenHash);
  }

  public async revokeTokenHash(tokenHash: string): Promise<void> {
    // 1. Immediate eviction from hot cache
    this.memoryCache.delete(tokenHash);

    // 2. Mark inactive in SQLite
    await db.update(sessions).set({ isActive: false }).where(eq(sessions.tokenHash, tokenHash));
  }

  public async revokeSessionById(sessionId: string): Promise<void> {
    const [row] = await db
      .select({ tokenHash: sessions.tokenHash })
      .from(sessions)
      .where(eq(sessions.id, sessionId))
      .limit(1);

    if (row) {
      this.memoryCache.delete(row.tokenHash);
      await db.update(sessions).set({ isActive: false }).where(eq(sessions.id, sessionId));
    }
  }

  public async revokeAllUserSessions(userId: string, exceptSessionId?: string): Promise<void> {
    // Evict all user sessions from hot cache
    for (const [hash, entry] of this.memoryCache.entries()) {
      if (entry.principal.id === userId && entry.principal.sessionId !== exceptSessionId) {
        this.memoryCache.delete(hash);
      }
    }

    if (exceptSessionId) {
      await db
        .update(sessions)
        .set({ isActive: false })
        .where(and(eq(sessions.userId, userId), eq(sessions.isActive, true)));
      // Re-enable current session if needed
      await db.update(sessions).set({ isActive: true }).where(eq(sessions.id, exceptSessionId));
    } else {
      await db.update(sessions).set({ isActive: false }).where(eq(sessions.userId, userId));
    }
  }

  public clearCache(): void {
    this.memoryCache.clear();
  }

  private async resolvePrincipal(userId: string, sessionId: string): Promise<UserPrincipal> {
    const [user] = await db.select().from(users).where(eq(users.id, userId)).limit(1);
    if (!user) {
      throw new Error(`User not found: ${userId}`);
    }

    // Fetch user roles
    const userRoleRows = await db
      .select({ roleId: userRoles.roleId })
      .from(userRoles)
      .where(eq(userRoles.userId, userId));

    let roles: RoleCode[] = userRoleRows.map((r) => r.roleId as RoleCode);
    if (roles.length === 0) {
      roles = ['VIEWER']; // Default role
    }

    const permissions = getPermissionsForRoles(roles);

    // Fetch user's organization if assigned
    const [orgMember] = await db
      .select({ organizationId: organizationMembers.organizationId })
      .from(organizationMembers)
      .where(eq(organizationMembers.userId, userId))
      .limit(1);

    return {
      id: user.id,
      email: user.email,
      displayName: user.displayName,
      organizationId: orgMember?.organizationId,
      roles,
      permissions,
      sessionId,
    };
  }
}

export const sessionStore = new SessionStore();
