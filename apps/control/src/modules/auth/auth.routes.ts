import type { FastifyInstance } from 'fastify';
import { AuthController } from './auth.controller.js';

export async function authRoutes(fastify: FastifyInstance) {
  const controller = new AuthController();

  fastify.post('/signup', controller.signup.bind(controller));
  fastify.post('/login', controller.login.bind(controller));
  fastify.post('/logout', controller.logout.bind(controller));
  fastify.get('/me', controller.me.bind(controller));
  fastify.post('/validate-session', controller.validateToken.bind(controller));
}
