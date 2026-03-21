import type { Database } from '@identity-starter/db';
import fp from 'fastify-plugin';
import type { EventBus } from '../infra/event-bus.js';

export interface Container {
  db: Database;
  eventBus: EventBus;
}

export const containerPlugin = fp(async (fastify, opts: { container: Container }) => {
  fastify.decorate('container', opts.container);
});

declare module 'fastify' {
  interface FastifyInstance {
    container: Container;
  }
}
