import { randomBytes } from 'node:crypto';
import { db } from '@mirrorgrid/db';
import { userRoles } from '@mirrorgrid/db/schema';
import { AppError } from '@mirrorgrid/platform';
import { hashPassword, verifyPassword, sessionStore } from '@mirrorgrid/security';
import { AuthRepository } from './auth.repository.js';
import type { LoginInput, SignupInput } from './auth.schema.js';

export class AuthService {
  constructor(private readonly repo: AuthRepository = new AuthRepository()) {}

  public hashToken(token: string): string {
    return sessionStore.hashToken(token);
  }

  public async signup(input: SignupInput) {
    const existing = await this.repo.findUserByEmail(input.email);
    if (existing) {
      throw AppError.conflict(`User with email '${input.email}' already exists`);
    }

    const passwordHash = await hashPassword(input.password);

    const user = await this.repo.createUser({
      email: input.email,
      passwordHash,
      displayName: input.displayName,
    });

    const orgName = input.organizationName || `${input.displayName}'s Team`;
    const orgSlug =
      orgName
        .toLowerCase()
        .replace(/[^a-z0-9]+/g, '-')
        .replace(/(^-|-$)/g, '') +
      '-' +
      randomBytes(3).toString('hex');

    const org = await this.repo.createOrganization({
      name: orgName,
      slug: orgSlug,
    });

    await this.repo.addMember({
      organizationId: org.id,
      userId: user.id,
    });

    // Assign initial ADMIN role to organization creator
    try {
      await db.insert(userRoles).values({
        userId: user.id,
        roleId: 'ADMIN',
      });
    } catch {
      // Ignore if already inserted
    }

    return { user, organization: org };
  }

  public async login(input: LoginInput, metadata?: { ip?: string; userAgent?: string }) {
    const user = await this.repo.findUserByEmail(input.email);
    if (!user) {
      throw AppError.unauthorized('Invalid email or password');
    }

    const valid = await verifyPassword(user.passwordHash, input.password);
    if (!valid) {
      throw AppError.unauthorized('Invalid email or password');
    }

    const orgInfo = await this.repo.getUserOrganization(user.id);
    if (!orgInfo) {
      throw AppError.internal('User does not belong to any organization');
    }

    const sessionResult = await sessionStore.createSession({
      userId: user.id,
      ipAddress: metadata?.ip,
      userAgent: metadata?.userAgent,
    });

    return {
      user: {
        id: user.id,
        email: user.email,
        displayName: user.displayName,
        organizationId: orgInfo.organizationId,
        organizationName: orgInfo.name,
        roles: sessionResult.principal.roles,
        permissions: Array.from(sessionResult.principal.permissions),
      },
      sessionId: sessionResult.principal.sessionId,
      token: sessionResult.token,
      expiresAt: sessionResult.expiresAt,
    };
  }

  public async validateSession(token: string) {
    const principal = await sessionStore.validateToken(token);
    if (!principal) {
      return null;
    }

    const orgInfo = await this.repo.getUserOrganization(principal.id);

    return {
      user: {
        id: principal.id,
        email: principal.email,
        displayName: principal.displayName,
        organizationId: orgInfo?.organizationId,
        roles: principal.roles,
        permissions: Array.from(principal.permissions),
      },
      sessionId: principal.sessionId,
    };
  }

  public async logout(token: string) {
    await sessionStore.revokeToken(token);
    const tokenHash = this.hashToken(token);
    await this.repo.invalidateSession(tokenHash);
  }

  public async revokeSession(sessionId: string) {
    await sessionStore.revokeSessionById(sessionId);
  }

  public async revokeAllSessions(userId: string, exceptSessionId?: string) {
    await sessionStore.revokeAllUserSessions(userId, exceptSessionId);
  }
}
