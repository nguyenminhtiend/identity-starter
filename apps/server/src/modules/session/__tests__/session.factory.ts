import { faker } from '@faker-js/faker';
import type { CreateSessionInput, Session } from '../session.schemas.js';

export function makeCreateSessionInput(
  overrides?: Partial<CreateSessionInput>,
): CreateSessionInput {
  return {
    userId: faker.string.uuid(),
    ipAddress: faker.internet.ipv4(),
    userAgent: faker.internet.userAgent(),
    ...overrides,
  };
}

export function makeSession(overrides?: Partial<Session>): Session {
  return {
    id: faker.string.uuid(),
    token: faker.string.alphanumeric(64),
    userId: faker.string.uuid(),
    expiresAt: faker.date.future(),
    lastActiveAt: faker.date.recent(),
    ipAddress: faker.internet.ipv4(),
    userAgent: faker.internet.userAgent(),
    createdAt: faker.date.recent(),
    ...overrides,
  };
}
