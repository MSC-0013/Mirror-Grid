import { eq, and, gt } from 'drizzle-orm';
import { db } from '@mirrorgrid/db';
import { users, sessions, organizations, organizationMembers } from '@mirrorgrid/db/schema';

export class AuthRepository {
  public async findUserByEmail(email: string) {
    const result = await db.select().from(users).where(eq(users.email, email)).limit(1);
    return result[0];
  }

  public async findUserById(id: string) {
    const result = await db.select().from(users).where(eq(users.id, id)).limit(1);
    return result[0];
  }

  public async createUser(data: { email: string; passwordHash: string; displayName: string }) {
    const result = await db.insert(users).values(data).returning();
    return result[0];
  }

  public async createOrganization(data: { name: string; slug: string }) {
    const result = await db.insert(organizations).values(data).returning();
    return result[0];
  }

  public async addMember(data: { organizationId: string; userId: string }) {
    const result = await db.insert(organizationMembers).values(data).returning();
    return result[0];
  }

  public async getUserOrganization(userId: string) {
    const result = await db
      .select({
        organizationId: organizations.id,
        name: organizations.name,
        slug: organizations.slug,
      })
      .from(organizationMembers)
      .innerJoin(organizations, eq(organizationMembers.organizationId, organizations.id))
      .where(eq(organizationMembers.userId, userId))
      .limit(1);

    return result[0];
  }

  public async createSession(data: {
    userId: string;
    tokenHash: string;
    expiresAt: Date;
    ipAddress?: string;
    userAgent?: string;
  }) {
    const result = await db.insert(sessions).values(data).returning();
    return result[0];
  }

  public async findActiveSession(tokenHash: string) {
    const now = new Date();
    const result = await db
      .select({
        session: sessions,
        user: {
          id: users.id,
          email: users.email,
          displayName: users.displayName,
        },
      })
      .from(sessions)
      .innerJoin(users, eq(sessions.userId, users.id))
      .where(
        and(
          eq(sessions.tokenHash, tokenHash),
          eq(sessions.isActive, true),
          gt(sessions.expiresAt, now)
        )
      )
      .limit(1);

    return result[0];
  }

  public async invalidateSession(tokenHash: string) {
    await db
      .update(sessions)
      .set({ isActive: false })
      .where(eq(sessions.tokenHash, tokenHash));
  }

  public async touchSession(tokenHash: string) {
    await db
      .update(sessions)
      .set({ lastSeenAt: new Date() })
      .where(eq(sessions.tokenHash, tokenHash));
  }
}
