import type { FastifyInstance, FastifyPluginAsync } from 'fastify';
import { accountRoutes } from '../modules/account/index.js';
import { authRoutes } from '../modules/auth/index.js';
import { clientRoutes } from '../modules/client/index.js';
import { mfaAuthRoutes, mfaRoutes } from '../modules/mfa/index.js';
import { passkeyRoutes } from '../modules/passkey/index.js';
import { userRoutes } from '../modules/user/index.js';

interface ModuleDefinition {
  plugin: FastifyPluginAsync;
  prefix: string;
}

const modules: ModuleDefinition[] = [
  { plugin: userRoutes, prefix: '/api/users' },
  { plugin: authRoutes, prefix: '/api/auth' },
  { plugin: passkeyRoutes, prefix: '/api/auth/passkeys' },
  { plugin: accountRoutes, prefix: '/api/account' },
  { plugin: mfaRoutes, prefix: '/api/account/mfa' },
  { plugin: mfaAuthRoutes, prefix: '/api/auth/mfa' },
  { plugin: clientRoutes, prefix: '/api/admin/clients' },
];

export async function registerModules(app: FastifyInstance) {
  for (const mod of modules) {
    await app.register(mod.plugin, { prefix: mod.prefix });
  }
}
