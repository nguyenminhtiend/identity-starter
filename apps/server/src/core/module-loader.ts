import type { FastifyInstance } from 'fastify';
import { userRoutes } from '../modules/user/index.js';

export async function registerModules(app: FastifyInstance) {
  await app.register(userRoutes, { prefix: '/api/users' });
}
