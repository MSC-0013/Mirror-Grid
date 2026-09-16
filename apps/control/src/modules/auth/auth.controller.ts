import type { FastifyRequest, FastifyReply } from 'fastify';
import { AppError } from '@mirrorgrid/platform';
import { AuthService } from './auth.service.js';
import { loginSchema, signupSchema } from './auth.schema.js';

export class AuthController {
  constructor(private readonly service: AuthService = new AuthService()) {}

  public async signup(req: FastifyRequest, reply: FastifyReply) {
    const parse = signupSchema.safeParse(req.body);
    if (!parse.success) {
      throw AppError.badRequest('Validation failed', parse.error.format());
    }

    const { organization } = await this.service.signup(parse.data);
    const loginResult = await this.service.login(
      { email: parse.data.email, password: parse.data.password },
      { ip: req.ip, userAgent: req.headers['user-agent'] },
    );

    reply.setCookie('mg_session', loginResult.token, {
      path: '/',
      httpOnly: true,
      sameSite: 'lax',
      secure: process.env.NODE_ENV === 'production',
      expires: loginResult.expiresAt,
    });

    return reply.status(201).send({
      user: loginResult.user,
      organization,
    });
  }

  public async login(req: FastifyRequest, reply: FastifyReply) {
    const parse = loginSchema.safeParse(req.body);
    if (!parse.success) {
      throw AppError.badRequest('Validation failed', parse.error.format());
    }

    const result = await this.service.login(parse.data, {
      ip: req.ip,
      userAgent: req.headers['user-agent'],
    });

    reply.setCookie('mg_session', result.token, {
      path: '/',
      httpOnly: true,
      sameSite: 'lax',
      secure: process.env.NODE_ENV === 'production',
      expires: result.expiresAt,
    });

    return reply.status(200).send({
      user: result.user,
    });
  }

  public async logout(req: FastifyRequest, reply: FastifyReply) {
    const token = req.cookies.mg_session;
    if (token) {
      await this.service.logout(token);
    }

    reply.clearCookie('mg_session', { path: '/' });
    return reply.status(204).send();
  }

  public async me(req: FastifyRequest, reply: FastifyReply) {
    const token = req.cookies.mg_session;
    if (!token) {
      throw AppError.unauthorized();
    }

    const validated = await this.service.validateSession(token);
    if (!validated) {
      reply.clearCookie('mg_session', { path: '/' });
      throw AppError.unauthorized('Session expired or invalid');
    }

    return reply.status(200).send({
      user: validated.user,
    });
  }

  public async validateToken(
    req: FastifyRequest<{ Body: { token: string } }>,
    reply: FastifyReply,
  ) {
    const token = req.body?.token || req.cookies.mg_session;
    if (!token) {
      return reply.status(200).send({ valid: false });
    }

    const validated = await this.service.validateSession(token);
    if (!validated) {
      return reply.status(200).send({ valid: false });
    }

    return reply.status(200).send({
      valid: true,
      user: validated.user,
    });
  }
}
