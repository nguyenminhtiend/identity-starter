import type { FastifyInstance, FastifyPluginAsync } from 'fastify';
import { authRoutes } from '../modules/auth/index.js';
import { userRoutes } from '../modules/user/index.js';

interface ModuleDefinition {
  plugin: FastifyPluginAsync;
  prefix: string;
}

const modules: ModuleDefinition[] = [
  { plugin: userRoutes, prefix: '/api/users' },
  { plugin: authRoutes, prefix: '/api/auth' },
];

export async function registerModules(app: FastifyInstance) {
  for (const mod of modules) {
    await app.register(mod.plugin, { prefix: mod.prefix });
  }
}
