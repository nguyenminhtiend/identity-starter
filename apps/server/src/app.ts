import cors from '@fastify/cors';
import helmet from '@fastify/helmet';
import Fastify, { type FastifyInstance, type FastifyServerOptions } from 'fastify';
import {
  serializerCompiler,
  validatorCompiler,
  type ZodTypeProvider,
} from 'fastify-type-provider-zod';
import { type Container, containerPlugin } from './core/container.js';
import { errorHandlerPlugin } from './core/plugins/error-handler.js';
import { type EventBus, InMemoryEventBus } from './infra/event-bus.js';
import { registerModules } from './infra/module-loader.js';

declare module 'fastify' {
  interface FastifyInstance {
    eventBus: EventBus;
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

  const eventBus = new InMemoryEventBus();
  app.decorate('eventBus', eventBus);

  app.get('/health', async () => ({ status: 'ok' }));

  await registerModules(app);

  return app;
}
