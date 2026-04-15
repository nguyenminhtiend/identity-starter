import { describe, expect, it } from 'vitest';
import {
  authorizeQuerySchema,
  consentSchema,
  revokeSchema,
  tokenRequestSchema,
  tokenResponseSchema,
  userinfoResponseSchema,
} from '../oauth.schemas.js';

const codeChallenge = 'a'.repeat(43);
const codeVerifier = 'b'.repeat(43);

describe('authorizeQuerySchema (PAR-only)', () => {
  it('accepts PAR authorize query with request_uri and client_id', () => {
    const result = authorizeQuerySchema.safeParse({
      request_uri: 'urn:ietf:params:oauth:request_uri:abc',
      client_id: 'client-par',
    });
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data).toEqual({
        request_uri: 'urn:ietf:params:oauth:request_uri:abc',
        client_id: 'client-par',
      });
    }
  });

  it('rejects PAR query with empty request_uri', () => {
    const result = authorizeQuerySchema.safeParse({
      request_uri: '',
      client_id: 'c',
    });
    expect(result.success).toBe(false);
  });

  it('rejects PAR query with empty client_id', () => {
    const result = authorizeQuerySchema.safeParse({
      request_uri: 'urn:ietf:params:oauth:request_uri:abc',
      client_id: '',
    });
    expect(result.success).toBe(false);
  });

  it('rejects non-PAR direct authorize query', () => {
    const result = authorizeQuerySchema.safeParse({
      response_type: 'code',
      client_id: 'client-1',
      redirect_uri: 'myapp://callback',
      scope: 'openid profile',
      state: 'csrf-token',
      code_challenge: codeChallenge,
      code_challenge_method: 'S256',
    });
    expect(result.success).toBe(false);
  });

  it('strips unknown fields', () => {
    const result = authorizeQuerySchema.safeParse({
      request_uri: 'urn:ietf:params:oauth:request_uri:abc',
      client_id: 'client-par',
      extra: 'x',
    });
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data).not.toHaveProperty('extra');
    }
  });
});

describe('tokenRequestSchema', () => {
  const authCodeValid = {
    grant_type: 'authorization_code' as const,
    code: 'auth-code',
    redirect_uri: 'https://app.example/cb',
    code_verifier: codeVerifier,
  };

  it('accepts authorization_code grant with required fields', () => {
    const result = tokenRequestSchema.safeParse(authCodeValid);
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.grant_type).toBe('authorization_code');
    }
  });

  it('accepts authorization_code with optional client credentials', () => {
    const result = tokenRequestSchema.safeParse({
      ...authCodeValid,
      client_id: 'cid',
      client_secret: 'secret',
    });
    expect(result.success).toBe(true);
  });

  it('rejects authorization_code missing code', () => {
    const { code: _c, ...rest } = authCodeValid;
    const result = tokenRequestSchema.safeParse(rest);
    expect(result.success).toBe(false);
  });

  it('rejects authorization_code missing redirect_uri', () => {
    const { redirect_uri: _r, ...rest } = authCodeValid;
    const result = tokenRequestSchema.safeParse(rest);
    expect(result.success).toBe(false);
  });

  it('rejects authorization_code with short code_verifier', () => {
    const result = tokenRequestSchema.safeParse({
      ...authCodeValid,
      code_verifier: 'a'.repeat(42),
    });
    expect(result.success).toBe(false);
  });

  const refreshValid = {
    grant_type: 'refresh_token' as const,
    refresh_token: 'rt-1',
  };

  it('accepts refresh_token grant with required refresh_token', () => {
    const result = tokenRequestSchema.safeParse(refreshValid);
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.grant_type).toBe('refresh_token');
    }
  });

  it('accepts refresh_token grant with optional scope and client fields', () => {
    const result = tokenRequestSchema.safeParse({
      ...refreshValid,
      scope: 'openid',
      client_id: 'cid',
      client_secret: 's',
    });
    expect(result.success).toBe(true);
  });

  it('rejects refresh_token grant missing refresh_token', () => {
    const result = tokenRequestSchema.safeParse({
      grant_type: 'refresh_token',
    });
    expect(result.success).toBe(false);
  });

  it('rejects unknown grant_type', () => {
    const result = tokenRequestSchema.safeParse({
      grant_type: 'password',
      username: 'u',
      password: 'p',
    });
    expect(result.success).toBe(false);
  });

  it('accepts client_credentials grant with optional scope and client fields', () => {
    const result = tokenRequestSchema.safeParse({
      grant_type: 'client_credentials',
      scope: 'api.read',
      client_id: 'cid',
      client_secret: 'secret',
    });
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.grant_type).toBe('client_credentials');
    }
  });

  it('accepts client_credentials grant with only grant_type', () => {
    const result = tokenRequestSchema.safeParse({
      grant_type: 'client_credentials',
    });
    expect(result.success).toBe(true);
  });

  it('strips unknown fields on authorization_code branch', () => {
    const result = tokenRequestSchema.safeParse({ ...authCodeValid, extra: 'y' });
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data).not.toHaveProperty('extra');
    }
  });
});

describe('consentSchema', () => {
  const valid = {
    client_id: 'client-1',
    scope: 'openid email',
    decision: 'approve' as const,
    state: 'a'.repeat(16),
    redirect_uri: 'myapp://cb',
    code_challenge: codeChallenge,
    code_challenge_method: 'S256' as const,
  };

  it('accepts approve decision with PKCE fields', () => {
    const result = consentSchema.safeParse(valid);
    expect(result.success).toBe(true);
  });

  it('accepts approve with optional nonce', () => {
    const result = consentSchema.safeParse({ ...valid, nonce: 'n1' });
    expect(result.success).toBe(true);
    if (result.success && result.data.decision === 'approve') {
      expect(result.data.nonce).toBe('n1');
    }
  });

  it('rejects approve without code_challenge', () => {
    const { code_challenge: _c, ...rest } = valid;
    const result = consentSchema.safeParse(rest);
    expect(result.success).toBe(false);
  });

  it('accepts deny decision', () => {
    const result = consentSchema.safeParse({ ...valid, decision: 'deny' });
    expect(result.success).toBe(true);
  });

  it('rejects invalid decision', () => {
    const result = consentSchema.safeParse({ ...valid, decision: 'maybe' });
    expect(result.success).toBe(false);
  });

  it('rejects missing state', () => {
    const { state: _s, ...rest } = valid;
    const result = consentSchema.safeParse(rest);
    expect(result.success).toBe(false);
  });

  it('strips unknown fields', () => {
    const result = consentSchema.safeParse({ ...valid, x: 1 });
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data).not.toHaveProperty('x');
    }
  });
});

describe('revokeSchema', () => {
  it('accepts token only', () => {
    const result = revokeSchema.safeParse({ token: 'tok' });
    expect(result.success).toBe(true);
  });

  it('accepts optional token_type_hint', () => {
    for (const hint of ['refresh_token', 'access_token'] as const) {
      const result = revokeSchema.safeParse({ token: 'tok', token_type_hint: hint });
      expect(result.success).toBe(true);
    }
  });

  it('rejects empty token', () => {
    const result = revokeSchema.safeParse({ token: '' });
    expect(result.success).toBe(false);
  });

  it('rejects invalid token_type_hint', () => {
    const result = revokeSchema.safeParse({ token: 't', token_type_hint: 'id_token' });
    expect(result.success).toBe(false);
  });
});

describe('tokenResponseSchema', () => {
  const base = {
    access_token: 'at',
    token_type: 'Bearer' as const,
    expires_in: 3600,
    scope: 'openid',
  };

  it('accepts required token response fields', () => {
    const result = tokenResponseSchema.safeParse(base);
    expect(result.success).toBe(true);
  });

  it('accepts optional refresh_token and id_token', () => {
    const result = tokenResponseSchema.safeParse({
      ...base,
      refresh_token: 'rt',
      id_token: 'jwt',
    });
    expect(result.success).toBe(true);
  });

  it('rejects wrong token_type', () => {
    const result = tokenResponseSchema.safeParse({ ...base, token_type: 'Mac' });
    expect(result.success).toBe(false);
  });
});

describe('userinfoResponseSchema', () => {
  it('accepts sub only', () => {
    const result = userinfoResponseSchema.safeParse({ sub: 'user-1' });
    expect(result.success).toBe(true);
  });

  it('accepts optional profile and email claims', () => {
    const result = userinfoResponseSchema.safeParse({
      sub: 'user-1',
      name: 'Ada',
      email: 'ada@example.com',
      email_verified: true,
    });
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.email_verified).toBe(true);
    }
  });

  it('rejects missing sub', () => {
    const result = userinfoResponseSchema.safeParse({
      email: 'a@b.com',
    });
    expect(result.success).toBe(false);
  });
});
