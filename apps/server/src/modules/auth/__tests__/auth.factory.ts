import { faker } from '@faker-js/faker';
import type { ChangePasswordInput, LoginInput, RegisterInput } from '../auth.schemas.js';

export function makeRegisterInput(overrides?: Partial<RegisterInput>): RegisterInput {
  return {
    email: faker.internet.email(),
    password: faker.internet.password({ length: 12 }),
    displayName: faker.person.fullName(),
    ...overrides,
  };
}

export function makeLoginInput(overrides?: Partial<LoginInput>): LoginInput {
  return {
    email: faker.internet.email(),
    password: faker.internet.password({ length: 12 }),
    ...overrides,
  };
}

export function makeChangePasswordInput(
  overrides?: Partial<ChangePasswordInput>,
): ChangePasswordInput {
  return {
    currentPassword: faker.internet.password({ length: 12 }),
    newPassword: faker.internet.password({ length: 12 }),
    ...overrides,
  };
}
