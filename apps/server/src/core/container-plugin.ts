import type { Database } from '@identity-starter/db';
import fp from 'fastify-plugin';

export interface Container {
  db: Database;
}

export const containerPlugin = fp(async (fastify, opts: { container: Container }) => {
  fastify.decorate('container', opts.container);
});

declare module 'fastify' {
  interface FastifyInstance {
    container: Container;
  }
}
