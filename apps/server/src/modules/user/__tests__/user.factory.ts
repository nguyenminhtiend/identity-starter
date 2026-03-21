import { faker } from '@faker-js/faker';
import type { CreateUserInput, User } from '../user.schemas.js';

export function makeCreateUserInput(overrides?: Partial<CreateUserInput>): CreateUserInput {
  return {
    email: faker.internet.email(),
    displayName: faker.person.fullName(),
    metadata: {},
    ...overrides,
  };
}

export function makeUser(overrides?: Partial<User>): User {
  return {
    id: faker.string.uuid(),
    email: faker.internet.email(),
    emailVerified: false,
    displayName: faker.person.fullName(),
    status: 'pending_verification',
    metadata: {},
    createdAt: faker.date.recent(),
    updatedAt: faker.date.recent(),
    ...overrides,
  };
}
