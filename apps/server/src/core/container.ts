import { createDb } from '@identity-starter/db';
import { InMemoryEventBus } from '../infra/event-bus.js';
import type { Container } from './container-plugin.js';
import { env } from './env.js';

export type { Container } from './container-plugin.js';
export { containerPlugin } from './container-plugin.js';

let instance: Container | null = null;

export const createContainer = (): Container => {
  if (instance) {
    return instance;
  }

  const { db } = createDb(env.DATABASE_URL);

  instance = { db, eventBus: new InMemoryEventBus() };
  return instance;
};

export const getContainer = (): Container => {
  if (!instance) {
    throw new Error('Container not initialized — call createContainer() first');
  }
  return instance;
};
