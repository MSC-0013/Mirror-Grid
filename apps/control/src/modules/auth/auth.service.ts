import { createHash, randomBytes } from 'node:crypto';
import * as argon2 from 'argon2';
import { AppError } from '@mirrorgrid/platform';
import { AuthRepository } from './auth.repository.js';
import type { LoginInput, SignupInput } from './auth.schema.js';

export class AuthService {
  constructor(private readonly repo: AuthRepository = new AuthRepository()) {}

  public hashToken(token: string): string {
    return createHash('sha256').update(token).digest('hex');
  }

  public async signup(input: SignupInput) {
    const existing = await this.repo.findUserByEmail(input.email);
    if (existing) {
      throw AppError.conflict(`User with email '${input.email}' already exists`);
    }

    const passwordHash = await argon2.hash(input.password, {
      type: argon2.argon2id,
      memoryCost: 65536,
      timeCost: 3,
    });

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

    return { user, organization: org };
  }

  public async login(input: LoginInput, metadata?: { ip?: string; userAgent?: string }) {
    const user = await this.repo.findUserByEmail(input.email);
    if (!user) {
      throw AppError.unauthorized('Invalid email or password');
    }

    const valid = await argon2.verify(user.passwordHash, input.password);
    if (!valid) {
      throw AppError.unauthorized('Invalid email or password');
    }

    const orgInfo = await this.repo.getUserOrganization(user.id);
    if (!orgInfo) {
      throw AppError.internal('User does not belong to any organization');
    }

    // Generate 32-byte cryptographically secure session token
    const plaintextToken = randomBytes(32).toString('hex');
    const tokenHash = this.hashToken(plaintextToken);

    // 7 days expiration
    const expiresAt = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000);

    await this.repo.createSession({
      userId: user.id,
      tokenHash,
      expiresAt,
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
      },
      token: plaintextToken,
      expiresAt,
    };
  }

  public async validateSession(token: string) {
    const tokenHash = this.hashToken(token);
    const active = await this.repo.findActiveSession(tokenHash);
    if (!active) {
      return null;
    }

    const orgInfo = await this.repo.getUserOrganization(active.user.id);
    // Touch session last_seen asynchronously
    void this.repo.touchSession(tokenHash).catch(() => {});

    return {
      user: {
        id: active.user.id,
        email: active.user.email,
        displayName: active.user.displayName,
        organizationId: orgInfo?.organizationId,
      },
      session: active.session,
    };
  }

  public async logout(token: string) {
    const tokenHash = this.hashToken(token);
    await this.repo.invalidateSession(tokenHash);
  }
}
