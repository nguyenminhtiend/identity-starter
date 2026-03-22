import { faker } from '@faker-js/faker';
import type { RenamePasskeyInput, UpdateProfileInput } from '../account.schemas.js';

export function makeUpdateProfileInput(
  overrides?: Partial<UpdateProfileInput>,
): UpdateProfileInput {
  return {
    displayName: faker.person.fullName(),
    metadata: { key: faker.lorem.word() },
    ...overrides,
  };
}

export function makeRenamePasskeyInput(
  overrides?: Partial<RenamePasskeyInput>,
): RenamePasskeyInput {
  return {
    name: faker.word.words(2),
    ...overrides,
  };
}
