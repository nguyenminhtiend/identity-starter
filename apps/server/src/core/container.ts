import type { Database } from '@identity-starter/db';
import { createDb } from '@identity-starter/db';
import fp from 'fastify-plugin';
import { type Env, env } from './env.js';

export interface Container {
  db: Database;
  env: Env;
}

let instance: Container | null = null;

export const createContainer = (): Container => {
  if (instance) {
    return instance;
  }

  const { db } = createDb(env.DATABASE_URL);

  instance = { db, env };
  return instance;
};

export const getContainer = (): Container => {
  if (!instance) {
    throw new Error('Container not initialized — call createContainer() first');
  }
  return instance;
};

export const containerPlugin = fp(async (fastify, opts: { container: Container }) => {
  fastify.decorate('container', opts.container);
});

declare module 'fastify' {
  interface FastifyInstance {
    container: Container;
  }
}
