import type { Database } from '@identity-starter/db';
import fp from 'fastify-plugin';
import type { Env } from './env.js';

export interface Container {
  db: Database;
  env: Env;
}

export const containerPlugin = fp(async (fastify, opts: { container: Container }) => {
  fastify.decorate('container', opts.container);
});

declare module 'fastify' {
  interface FastifyInstance {
    container: Container;
  }
}
