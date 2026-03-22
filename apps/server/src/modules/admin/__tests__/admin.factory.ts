import { faker } from '@faker-js/faker';
import type { UpdateUserStatusInput, UserListQuery } from '../admin.schemas.js';

export function makeUserListQuery(overrides?: Partial<UserListQuery>): UserListQuery {
  return {
    page: 1,
    limit: 20,
    ...overrides,
  };
}

export function makeUpdateUserStatusInput(
  overrides?: Partial<UpdateUserStatusInput>,
): UpdateUserStatusInput {
  return {
    status: faker.helpers.arrayElement(['active', 'suspended'] as const),
    ...overrides,
  };
}
