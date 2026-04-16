import { faker } from '@faker-js/faker';
import type { CreateClientInput } from '../client.schemas.js';

export function buildCreateClientInput(
  overrides: Partial<CreateClientInput> = {},
): CreateClientInput {
  const { isFirstParty = false, ...rest } = overrides;
  return {
    clientName: faker.company.name(),
    redirectUris: ['https://example.com/callback'],
    grantTypes: ['authorization_code'],
    scope: 'openid profile',
    tokenEndpointAuthMethod: 'client_secret_basic',
    isConfidential: true,
    ...rest,
    isFirstParty,
  };
}
