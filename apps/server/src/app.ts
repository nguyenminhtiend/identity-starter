import cors from '@fastify/cors';
import helmet from '@fastify/helmet';
import type { Database } from '@identity-starter/db';
import Fastify, { type FastifyInstance } from 'fastify';
import {
  type ZodTypeProvider,
  serializerCompiler,
  validatorCompiler,
} from 'fastify-type-provider-zod';
import type { Emitter } from 'mitt';
import { createEventBus } from './infra/event-bus.js';
import { registerModules } from './infra/module-loader.js';
import type { UserEvents } from './modules/user/user.events.js';

export type AllEvents = UserEvents;

declare module 'fastify' {
  interface FastifyInstance {
    db: Database;
    eventBus: Emitter<AllEvents>;
  }
}

export interface AppOptions {
  db: Database;
  logger?: boolean | object;
}

export async function buildApp(options: AppOptions): Promise<FastifyInstance> {
  const app = Fastify({
    logger: options.logger ?? {
      level: 'info',
    },
  }).withTypeProvider<ZodTypeProvider>();

  app.setValidatorCompiler(validatorCompiler);
  app.setSerializerCompiler(serializerCompiler);

  await app.register(cors);
  await app.register(helmet);

  const eventBus = createEventBus<AllEvents>();
  app.decorate('db', options.db);
  app.decorate('eventBus', eventBus);

  app.get('/health', async () => ({ status: 'ok' }));

  await registerModules(app);

  return app;
}
