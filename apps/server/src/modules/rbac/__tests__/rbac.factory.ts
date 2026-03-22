import { faker } from '@faker-js/faker';
import type { CreateRoleInput } from '../rbac.schemas.js';

export function makeCreateRoleInput(overrides?: Partial<CreateRoleInput>): CreateRoleInput {
  return {
    name: faker.word.noun(),
    description: faker.lorem.sentence(),
    ...overrides,
  };
}
