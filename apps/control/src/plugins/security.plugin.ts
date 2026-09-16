import type { FastifyInstance, FastifyRequest, FastifyReply } from 'fastify';
import fp from 'fastify-plugin';
import { AppError } from '@mirrorgrid/platform';
import {
  sessionStore,
  authorizer,
  RateLimiter,
  auditLogger,
  type PermissionCode,
  type UserPrincipal,
} from '@mirrorgrid/security';

declare module 'fastify' {
  interface FastifyRequest {
    principal?: UserPrincipal | null;
    sessionToken?: string | null;
  }

  interface FastifyInstance {
    authenticate: (req: FastifyRequest, reply: FastifyReply) => Promise<void>;
    requireAuth: (req: FastifyRequest, reply: FastifyReply) => Promise<void>;
    requirePermission: (
      permission: PermissionCode,
    ) => (req: FastifyRequest, reply: FastifyReply) => Promise<void>;
    rateLimiter: RateLimiter;
    auditLogger: typeof auditLogger;
  }
}

export interface SecurityPluginOptions {
  rateLimitCapacity?: number;
  rateLimitRefillRate?: number;
  enableRateLimiting?: boolean;
}

async function securityPluginFn(fastify: FastifyInstance, options: SecurityPluginOptions = {}) {
  const rateLimiter = new RateLimiter({
    capacity: options.rateLimitCapacity ?? 100,
    refillRatePerSec: options.rateLimitRefillRate ?? 2,
    adaptive: true,
  });

  fastify.decorate('rateLimiter', rateLimiter);
  fastify.decorate('auditLogger', auditLogger);

  // Authenticate helper: parses token from cookie or Authorization header
  const authenticate = async (req: FastifyRequest, _reply: FastifyReply) => {
    if (req.principal !== undefined) {
      return;
    }

    let token: string | undefined;

    // Check cookie
    const cookies = req.cookies;
    if (cookies?.mg_session) {
      token = cookies.mg_session;
    } else if (cookies?.session) {
      token = cookies.session;
    }

    // Fall back to Authorization: Bearer <token>
    if (!token && req.headers.authorization?.startsWith('Bearer ')) {
      token = req.headers.authorization.slice(7).trim();
    }

    if (!token) {
      req.principal = null;
      req.sessionToken = null;
      return;
    }

    const principal = await sessionStore.validateToken(token);
    req.principal = principal;
    req.sessionToken = token;
  };

  const requireAuth = async (req: FastifyRequest, reply: FastifyReply) => {
    await authenticate(req, reply);
    if (!req.principal) {
      throw AppError.unauthorized('Authentication required or session expired/revoked');
    }
  };

  const requirePermission = (permission: PermissionCode) => {
    return async (req: FastifyRequest, reply: FastifyReply) => {
      await requireAuth(req, reply);
      if (!req.principal) {
        throw AppError.unauthorized('Authentication required');
      }
      authorizer.assertPermission(req.principal, permission);
    };
  };

  fastify.decorate('authenticate', authenticate);
  fastify.decorate('requireAuth', requireAuth);
  fastify.decorate('requirePermission', requirePermission);

  // Global Rate Limiting Hook (only on /api routes, skipping /health)
  if (options.enableRateLimiting !== false) {
    fastify.addHook('onRequest', async (req, reply) => {
      const url = req.url;
      if (!url.startsWith('/api/')) {
        return;
      }

      const clientIp =
        (req.headers['x-forwarded-for'] as string)?.split(',')[0]?.trim() || req.ip || '127.0.0.1';

      const result = rateLimiter.checkLimit(clientIp);

      reply.header('RateLimit-Limit', result.limit);
      reply.header('RateLimit-Remaining', result.remaining);
      reply.header('RateLimit-Reset', result.resetSeconds);

      if (!result.allowed) {
        reply.header('Retry-After', result.retryAfterSeconds);
        throw AppError.rateLimited(
          `Too many requests. Please retry in ${result.retryAfterSeconds}s`,
        );
      }
    });

    // Adaptive Penalty Hook: track status code outcomes
    fastify.addHook('onResponse', async (req, reply) => {
      const url = req.url;
      if (!url.startsWith('/api/')) {
        return;
      }

      const clientIp =
        (req.headers['x-forwarded-for'] as string)?.split(',')[0]?.trim() || req.ip || '127.0.0.1';

      const statusCode = reply.statusCode;
      if (statusCode === 401 || statusCode === 403 || statusCode === 429) {
        rateLimiter.recordClientError(clientIp);
      } else if (statusCode >= 200 && statusCode < 300) {
        rateLimiter.recordSuccess(clientIp);
      }
    });
  }
}

export const securityPlugin = fp(securityPluginFn, {
  name: 'mirrorgrid-security',
});
