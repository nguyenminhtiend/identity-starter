import { describe, expect, it } from 'vitest';
import {
  clientIdParamSchema,
  clientListResponseSchema,
  clientResponseSchema,
  clientWithSecretResponseSchema,
  createClientSchema,
  updateClientSchema,
} from '../client.schemas.js';

const validUuid = '550e8400-e29b-41d4-a716-446655440000';

const validCreate = {
  clientName: 'My OAuth Client',
  redirectUris: ['https://example.com/callback'],
  grantTypes: ['authorization_code'] as const,
  scope: 'openid profile',
  tokenEndpointAuthMethod: 'client_secret_basic' as const,
  isConfidential: true,
};

describe('createClientSchema', () => {
  it('accepts valid payload', () => {
    const result = createClientSchema.safeParse(validCreate);
    expect(result.success).toBe(true);
  });

  it('accepts all allowed grant types', () => {
    const result = createClientSchema.safeParse({
      ...validCreate,
      grantTypes: ['authorization_code', 'refresh_token', 'client_credentials'],
    });
    expect(result.success).toBe(true);
  });

  it('rejects empty clientName', () => {
    const result = createClientSchema.safeParse({ ...validCreate, clientName: '' });
    expect(result.success).toBe(false);
  });

  it('rejects clientName over 255 chars', () => {
    const result = createClientSchema.safeParse({ ...validCreate, clientName: 'a'.repeat(256) });
    expect(result.success).toBe(false);
  });

  it('rejects empty redirectUris array', () => {
    const result = createClientSchema.safeParse({ ...validCreate, redirectUris: [] });
    expect(result.success).toBe(false);
  });

  it('rejects non-url redirect entry', () => {
    const result = createClientSchema.safeParse({
      ...validCreate,
      redirectUris: ['not-a-url'],
    });
    expect(result.success).toBe(false);
  });

  it('rejects unknown grant type', () => {
    const result = createClientSchema.safeParse({
      ...validCreate,
      grantTypes: ['implicit'],
    });
    expect(result.success).toBe(false);
  });

  it('rejects empty scope', () => {
    const result = createClientSchema.safeParse({ ...validCreate, scope: '' });
    expect(result.success).toBe(false);
  });

  it('rejects invalid tokenEndpointAuthMethod', () => {
    const result = createClientSchema.safeParse({
      ...validCreate,
      tokenEndpointAuthMethod: 'private_key_jwt',
    });
    expect(result.success).toBe(false);
  });

  it('accepts client_secret_post and none auth methods', () => {
    expect(
      createClientSchema.safeParse({
        ...validCreate,
        tokenEndpointAuthMethod: 'client_secret_post',
      }).success,
    ).toBe(true);
    expect(
      createClientSchema.safeParse({
        ...validCreate,
        tokenEndpointAuthMethod: 'none',
      }).success,
    ).toBe(true);
  });

  it('defaults isFirstParty to false when omitted', () => {
    const result = createClientSchema.safeParse(validCreate);
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.isFirstParty).toBe(false);
    }
  });

  it('accepts isFirstParty: true', () => {
    const result = createClientSchema.safeParse({ ...validCreate, isFirstParty: true });
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.isFirstParty).toBe(true);
    }
  });

  it('rejects non-boolean isConfidential', () => {
    const result = createClientSchema.safeParse({
      ...validCreate,
      isConfidential: 'yes',
    });
    expect(result.success).toBe(false);
  });

  it('rejects missing required field', () => {
    const result = createClientSchema.safeParse({
      clientName: 'x',
      redirectUris: ['https://a.com'],
      grantTypes: ['authorization_code'],
      scope: 's',
      tokenEndpointAuthMethod: 'none',
    });
    expect(result.success).toBe(false);
  });
});

describe('updateClientSchema', () => {
  it('accepts empty object', () => {
    const result = updateClientSchema.safeParse({});
    expect(result.success).toBe(true);
  });

  it('accepts partial valid updates', () => {
    const result = updateClientSchema.safeParse({ clientName: 'Renamed' });
    expect(result.success).toBe(true);
  });

  it('applies same validations when fields are present', () => {
    expect(updateClientSchema.safeParse({ clientName: '' }).success).toBe(false);
    expect(updateClientSchema.safeParse({ redirectUris: [] }).success).toBe(false);
    expect(updateClientSchema.safeParse({ redirectUris: ['https://b.com'] }).success).toBe(true);
    expect(updateClientSchema.safeParse({ scope: '' }).success).toBe(false);
    expect(updateClientSchema.safeParse({ grantTypes: ['client_credentials'] }).success).toBe(true);
    expect(updateClientSchema.safeParse({ grantTypes: ['implicit'] }).success).toBe(false);
    expect(
      updateClientSchema.safeParse({ tokenEndpointAuthMethod: 'client_secret_basic' }).success,
    ).toBe(true);
    expect(updateClientSchema.safeParse({ tokenEndpointAuthMethod: 'invalid' }).success).toBe(
      false,
    );
    expect(updateClientSchema.safeParse({ isConfidential: false }).success).toBe(true);
  });
});

describe('clientResponseSchema', () => {
  const valid = {
    id: validUuid,
    clientId: 'a1b2c3d4e5f6a7b8c9d0e1f2a3b4c5d6',
    clientName: 'App',
    description: null,
    redirectUris: ['https://example.com/cb'],
    grantTypes: ['authorization_code'],
    responseTypes: ['code'],
    scope: 'openid',
    tokenEndpointAuthMethod: 'client_secret_basic',
    isConfidential: true,
    isFirstParty: false,
    logoUri: null,
    tosUri: null,
    policyUri: null,
    applicationType: 'web' as const,
    status: 'active' as const,
    createdAt: new Date(),
    updatedAt: new Date(),
  };

  it('accepts full safe client shape', () => {
    const result = clientResponseSchema.safeParse(valid);
    expect(result.success).toBe(true);
  });

  it('rejects invalid responseTypes entry', () => {
    const result = clientResponseSchema.safeParse({
      ...valid,
      responseTypes: ['token'],
    });
    expect(result.success).toBe(false);
  });

  it('rejects invalid applicationType', () => {
    const result = clientResponseSchema.safeParse({
      ...valid,
      applicationType: 'mobile',
    });
    expect(result.success).toBe(false);
  });

  it('rejects invalid status', () => {
    const result = clientResponseSchema.safeParse({
      ...valid,
      status: 'revoked',
    });
    expect(result.success).toBe(false);
  });
});

describe('clientListResponseSchema', () => {
  const item = {
    id: validUuid,
    clientId: 'cid',
    clientName: 'App',
    description: null,
    redirectUris: ['https://x.com'],
    grantTypes: ['authorization_code'],
    responseTypes: ['code'],
    scope: 'openid',
    tokenEndpointAuthMethod: 'none',
    isConfidential: false,
    isFirstParty: false,
    logoUri: null,
    tosUri: null,
    policyUri: null,
    applicationType: 'native' as const,
    status: 'suspended' as const,
    createdAt: new Date(),
    updatedAt: new Date(),
  };

  it('accepts empty list', () => {
    expect(clientListResponseSchema.safeParse([]).success).toBe(true);
  });

  it('accepts list of clients', () => {
    expect(clientListResponseSchema.safeParse([item]).success).toBe(true);
  });
});

describe('clientWithSecretResponseSchema', () => {
  const base = {
    id: validUuid,
    clientId: 'cid',
    clientName: 'App',
    description: null,
    redirectUris: ['https://x.com'],
    grantTypes: ['authorization_code'],
    responseTypes: ['code'],
    scope: 'openid',
    tokenEndpointAuthMethod: 'client_secret_basic',
    isConfidential: true,
    isFirstParty: false,
    logoUri: null,
    tosUri: null,
    policyUri: null,
    applicationType: 'web' as const,
    status: 'active' as const,
    createdAt: new Date(),
    updatedAt: new Date(),
  };

  it('accepts clientSecret', () => {
    const result = clientWithSecretResponseSchema.safeParse({
      ...base,
      clientSecret: 'plaintext-secret-once',
    });
    expect(result.success).toBe(true);
  });

  it('rejects empty clientSecret', () => {
    const result = clientWithSecretResponseSchema.safeParse({
      ...base,
      clientSecret: '',
    });
    expect(result.success).toBe(false);
  });
});

describe('clientIdParamSchema', () => {
  it('accepts valid UUID', () => {
    const result = clientIdParamSchema.safeParse({ id: validUuid });
    expect(result.success).toBe(true);
  });

  it('rejects invalid id', () => {
    const result = clientIdParamSchema.safeParse({ id: 'not-uuid' });
    expect(result.success).toBe(false);
  });
});
