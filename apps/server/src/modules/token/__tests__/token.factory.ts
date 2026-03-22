import { faker } from '@faker-js/faker';

import type { CreateRefreshTokenParams } from '../refresh-token.service.js';

export function buildCreateRefreshTokenParams(
  overrides?: Partial<CreateRefreshTokenParams>,
): CreateRefreshTokenParams {
  return {
    clientId: faker.string.uuid(),
    userId: faker.string.uuid(),
    scope: 'openid profile',
    expiresInSeconds: 2_592_000,
    ...overrides,
  };
}
