import cookie from '@fastify/cookie';
import cors from '@fastify/cors';
import formbody from '@fastify/formbody';
import helmet from '@fastify/helmet';
import rateLimit from '@fastify/rate-limit';
import { sql } from 'drizzle-orm';
import Fastify, { type FastifyInstance, type FastifyServerOptions } from 'fastify';
import {
  serializerCompiler,
  validatorCompiler,
  type ZodTypeProvider,
} from 'fastify-type-provider-zod';
import { type Container, containerPlugin } from './core/container-plugin.js';
import { env } from './core/env.js';
import { registerModules } from './core/module-loader.js';
import { adminPlugin } from './core/plugins/admin.js';
import { authPlugin } from './core/plugins/auth.js';
import { errorHandlerPlugin } from './core/plugins/error-handler.js';
import { rbacPlugin } from './core/plugins/rbac.js';
import { registerAuditListener } from './modules/audit/audit.listener.js';
import { backfillAdminRoles, seedSystemRoles } from './modules/rbac/rbac.service.js';
import { validateSession } from './modules/session/session.service.js';

export interface AppOptions {
  container: Container;
  logger?: FastifyServerOptions['logger'];
}

export async function buildApp(options: AppOptions): Promise<FastifyInstance> {
  const app = Fastify({
    logger: options.logger ?? { level: 'info' },
    genReqId: () => crypto.randomUUID(),
  }).withTypeProvider<ZodTypeProvider>();

  app.setValidatorCompiler(validatorCompiler);
  app.setSerializerCompiler(serializerCompiler);

  await app.register(cors, {
    origin: env.WEBAUTHN_ORIGIN,
    credentials: true,
  });
  await app.register(helmet);
  await app.register(formbody);
  await app.register(cookie, {
    secret: env.COOKIE_SECRET,
    parseOptions: {},
  });

  if (env.NODE_ENV !== 'test' && env.RATE_LIMIT_ENABLED) {
    await app.register(rateLimit, { max: 100, timeWindow: '1 minute' });
  }
  await app.register(containerPlugin, { container: options.container });
  await app.register(errorHandlerPlugin);

  await app.register(authPlugin, { validateSession });
  await app.register(adminPlugin);
  await app.register(rbacPlugin);

  app.get('/health', async (request) => {
    const checks: Record<string, string> = {};

    try {
      await request.server.container.db.execute(sql`SELECT 1`);
      checks.database = 'ok';
    } catch {
      checks.database = 'error';
    }

    const status = Object.values(checks).every((v) => v === 'ok') ? 'ok' : 'degraded';

    return { status, checks };
  });

  await registerModules(app);

  await seedSystemRoles(options.container.db);
  await backfillAdminRoles(options.container.db);
  registerAuditListener(options.container.db, options.container.eventBus);

  return app;
}
