import type { FastifyInstance } from 'fastify';
import { authRoutes } from '../modules/auth/index.js';
import { userRoutes } from '../modules/user/index.js';

export async function registerModules(app: FastifyInstance) {
  await app.register(userRoutes, { prefix: '/api/users' });
  await app.register(authRoutes, { prefix: '/api/auth' });
}
