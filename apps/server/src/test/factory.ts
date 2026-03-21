import type { CreateUserInput, User } from '../modules/user/user.schemas.js';

let counter = 0;

export function makeCreateUserInput(overrides?: Partial<CreateUserInput>): CreateUserInput {
  counter++;
  return {
    email: `user${counter}_${Date.now()}@test.com`,
    displayName: `Test User ${counter}`,
    passwordHash: null,
    metadata: {},
    ...overrides,
  };
}

export function makeUser(overrides?: Partial<User>): User {
  counter++;
  return {
    id: crypto.randomUUID(),
    email: `user${counter}_${Date.now()}@test.com`,
    emailVerified: false,
    passwordHash: 'hashed_password',
    displayName: `Test User ${counter}`,
    status: 'pending_verification',
    metadata: {},
    createdAt: new Date(),
    updatedAt: new Date(),
    ...overrides,
  };
}
