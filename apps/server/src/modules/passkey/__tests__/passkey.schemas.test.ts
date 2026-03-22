import { describe, expect, it } from 'vitest';
import {
  authenticationVerifyBodySchema,
  authResponseSchema,
  registrationVerifyBodySchema,
  registrationVerifyResponseSchema,
} from '../passkey.schemas.js';

describe('registrationVerifyBodySchema', () => {
  const validInput = {
    id: 'credential-id-base64url',
    rawId: 'credential-id-base64url',
    response: {
      clientDataJSON: 'base64url-encoded',
      attestationObject: 'base64url-encoded',
    },
    type: 'public-key',
  };

  it('accepts valid input with required fields only', () => {
    const result = registrationVerifyBodySchema.safeParse(validInput);
    expect(result.success).toBe(true);
  });

  it('accepts valid input with all optional fields', () => {
    const result = registrationVerifyBodySchema.safeParse({
      ...validInput,
      authenticatorAttachment: 'platform',
      clientExtensionResults: { credProps: { rk: true } },
      response: {
        ...validInput.response,
        transports: ['internal', 'hybrid'],
        authenticatorData: 'base64url',
        publicKeyAlgorithm: -7,
        publicKey: 'base64url',
      },
    });
    expect(result.success).toBe(true);
  });

  it('rejects missing id', () => {
    const { id: _, ...input } = validInput;
    const result = registrationVerifyBodySchema.safeParse(input);
    expect(result.success).toBe(false);
  });

  it('rejects missing rawId', () => {
    const { rawId: _, ...input } = validInput;
    const result = registrationVerifyBodySchema.safeParse(input);
    expect(result.success).toBe(false);
  });

  it('rejects missing response', () => {
    const { response: _, ...input } = validInput;
    const result = registrationVerifyBodySchema.safeParse(input);
    expect(result.success).toBe(false);
  });

  it('rejects missing type', () => {
    const { type: _, ...input } = validInput;
    const result = registrationVerifyBodySchema.safeParse(input);
    expect(result.success).toBe(false);
  });

  it('rejects missing clientDataJSON in response', () => {
    const result = registrationVerifyBodySchema.safeParse({
      ...validInput,
      response: { attestationObject: 'base64url' },
    });
    expect(result.success).toBe(false);
  });

  it('rejects missing attestationObject in response', () => {
    const result = registrationVerifyBodySchema.safeParse({
      ...validInput,
      response: { clientDataJSON: 'base64url' },
    });
    expect(result.success).toBe(false);
  });

  it('strips unknown fields', () => {
    const result = registrationVerifyBodySchema.safeParse({
      ...validInput,
      unknownField: 'should be stripped',
    });
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data).not.toHaveProperty('unknownField');
    }
  });
});

describe('authenticationVerifyBodySchema', () => {
  const validInput = {
    id: 'credential-id-base64url',
    rawId: 'credential-id-base64url',
    response: {
      clientDataJSON: 'base64url-encoded',
      authenticatorData: 'base64url-encoded',
      signature: 'base64url-encoded',
    },
    type: 'public-key',
  };

  it('accepts valid input with required fields only', () => {
    const result = authenticationVerifyBodySchema.safeParse(validInput);
    expect(result.success).toBe(true);
  });

  it('accepts valid input with all optional fields', () => {
    const result = authenticationVerifyBodySchema.safeParse({
      ...validInput,
      authenticatorAttachment: 'cross-platform',
      clientExtensionResults: {},
      response: {
        ...validInput.response,
        userHandle: 'user-handle-base64url',
      },
    });
    expect(result.success).toBe(true);
  });

  it('rejects missing id', () => {
    const { id: _, ...input } = validInput;
    const result = authenticationVerifyBodySchema.safeParse(input);
    expect(result.success).toBe(false);
  });

  it('rejects missing signature in response', () => {
    const result = authenticationVerifyBodySchema.safeParse({
      ...validInput,
      response: {
        clientDataJSON: 'base64url',
        authenticatorData: 'base64url',
      },
    });
    expect(result.success).toBe(false);
  });

  it('rejects missing authenticatorData in response', () => {
    const result = authenticationVerifyBodySchema.safeParse({
      ...validInput,
      response: {
        clientDataJSON: 'base64url',
        signature: 'base64url',
      },
    });
    expect(result.success).toBe(false);
  });

  it('strips unknown fields', () => {
    const result = authenticationVerifyBodySchema.safeParse({
      ...validInput,
      unknownField: 'should be stripped',
    });
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data).not.toHaveProperty('unknownField');
    }
  });
});

describe('registrationVerifyResponseSchema', () => {
  it('accepts valid response', () => {
    const result = registrationVerifyResponseSchema.safeParse({
      passkeyId: 'passkey-uuid',
    });
    expect(result.success).toBe(true);
  });

  it('rejects missing passkeyId', () => {
    const result = registrationVerifyResponseSchema.safeParse({});
    expect(result.success).toBe(false);
  });
});

describe('authResponseSchema', () => {
  const validInput = {
    token: 'session-token',
    user: {
      id: '550e8400-e29b-41d4-a716-446655440000',
      email: 'test@example.com',
      displayName: 'Test User',
      status: 'active',
    },
  };

  it('accepts valid response', () => {
    const result = authResponseSchema.safeParse(validInput);
    expect(result.success).toBe(true);
  });

  it('rejects missing token', () => {
    const { token: _, ...input } = validInput;
    const result = authResponseSchema.safeParse(input);
    expect(result.success).toBe(false);
  });

  it('rejects invalid user id', () => {
    const result = authResponseSchema.safeParse({
      ...validInput,
      user: { ...validInput.user, id: 'not-a-uuid' },
    });
    expect(result.success).toBe(false);
  });

  it('rejects invalid status', () => {
    const result = authResponseSchema.safeParse({
      ...validInput,
      user: { ...validInput.user, status: 'invalid' },
    });
    expect(result.success).toBe(false);
  });
});
