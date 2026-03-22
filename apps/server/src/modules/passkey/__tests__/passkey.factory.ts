import { faker } from '@faker-js/faker';
import type { AuthenticationResponseJSON, RegistrationResponseJSON } from '@simplewebauthn/server';

export function makeRegistrationResponse(
  overrides?: Partial<RegistrationResponseJSON>,
): RegistrationResponseJSON {
  return {
    id: faker.string.alphanumeric(43),
    rawId: faker.string.alphanumeric(43),
    response: {
      clientDataJSON: faker.string.alphanumeric(100),
      attestationObject: faker.string.alphanumeric(200),
    },
    authenticatorAttachment: 'platform',
    clientExtensionResults: {},
    type: 'public-key',
    ...overrides,
  };
}

export function makeAuthenticationResponse(
  overrides?: Partial<AuthenticationResponseJSON>,
): AuthenticationResponseJSON {
  return {
    id: faker.string.alphanumeric(43),
    rawId: faker.string.alphanumeric(43),
    response: {
      clientDataJSON: faker.string.alphanumeric(100),
      authenticatorData: faker.string.alphanumeric(74),
      signature: faker.string.alphanumeric(64),
      userHandle: faker.string.alphanumeric(32),
    },
    authenticatorAttachment: 'platform',
    clientExtensionResults: {},
    type: 'public-key',
    ...overrides,
  };
}

export function makePasskeyRow(overrides?: Record<string, unknown>) {
  return {
    id: faker.string.uuid(),
    userId: faker.string.uuid(),
    credentialId: faker.string.alphanumeric(43),
    publicKey: new Uint8Array([1, 2, 3, 4]),
    counter: 0,
    deviceType: 'multiDevice',
    backedUp: true,
    transports: ['internal'] as string[],
    name: null,
    aaguid: '00000000-0000-0000-0000-000000000000',
    createdAt: faker.date.recent(),
    ...overrides,
  };
}
