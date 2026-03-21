import type { Database } from '@identity-starter/db';
import type { FastifyInstance } from 'fastify';
import { buildApp } from '../app.js';
import type { Container } from '../core/container-plugin.js';
import { type EventBus, InMemoryEventBus } from '../infra/event-bus.js';

export interface BuildTestAppOptions {
  db: Database;
  eventBus?: EventBus;
}

export async function buildTestApp(options: BuildTestAppOptions): Promise<FastifyInstance> {
  const container: Container = {
    db: options.db,
    eventBus: options.eventBus ?? new InMemoryEventBus(),
  };

  const app = await buildApp({
    container,
    logger: false,
  });

  await app.ready();
  return app;
}
