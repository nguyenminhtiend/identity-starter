import cors from '@fastify/cors';
import helmet from '@fastify/helmet';
import Fastify, { type FastifyInstance, type FastifyServerOptions } from 'fastify';
import {
  serializerCompiler,
  validatorCompiler,
  type ZodTypeProvider,
} from 'fastify-type-provider-zod';
import type { Emitter } from 'mitt';
import { type Container, containerPlugin } from './core/container.js';
import { errorHandlerPlugin } from './core/plugins/error-handler.js';
import { createEventBus } from './infra/event-bus.js';
import type { AllEvents } from './infra/events.js';
import { registerModules } from './infra/module-loader.js';

declare module 'fastify' {
  interface FastifyInstance {
    eventBus: Emitter<AllEvents>;
  }
}

export interface AppOptions {
  container: Container;
  logger?: FastifyServerOptions['logger'];
}

export async function buildApp(options: AppOptions): Promise<FastifyInstance> {
  const app = Fastify({
    logger: options.logger ?? { level: 'info' },
  }).withTypeProvider<ZodTypeProvider>();

  app.setValidatorCompiler(validatorCompiler);
  app.setSerializerCompiler(serializerCompiler);

  await app.register(cors);
  await app.register(helmet);
  await app.register(containerPlugin, { container: options.container });
  await app.register(errorHandlerPlugin);

  const eventBus = createEventBus<AllEvents>();
  app.decorate('eventBus', eventBus);

  app.get('/health', async () => ({ status: 'ok' }));

  await registerModules(app);

  return app;
}
