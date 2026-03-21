import type { Database } from '@identity-starter/db';
import type { FastifyInstance } from 'fastify';
import { buildApp } from '../app.js';
import type { Container } from '../core/container-plugin.js';
import type { EventBus } from '../infra/event-bus.js';

export interface BuildTestAppOptions {
  db: Database;
  eventBus?: EventBus;
}

export async function buildTestApp(options: BuildTestAppOptions): Promise<FastifyInstance> {
  const container: Container = {
    db: options.db,
  };

  const app = await buildApp({
    container,
    eventBus: options.eventBus,
    logger: false,
  });

  await app.ready();
  return app;
}
