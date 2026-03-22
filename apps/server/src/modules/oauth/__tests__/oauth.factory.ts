import { faker } from '@faker-js/faker';
import type { AuthorizeQueryInput, ConsentInput, TokenRequestInput } from '../oauth.schemas.js';

const pkceChallenge = () => 'a'.repeat(43);
const pkceVerifier = () => 'b'.repeat(43);

export function buildAuthorizeQuery(overrides?: Partial<AuthorizeQueryInput>): AuthorizeQueryInput {
  return {
    response_type: 'code',
    client_id: faker.string.alphanumeric(32),
    redirect_uri: 'https://example.com/callback',
    scope: 'openid profile email',
    state: faker.string.alphanumeric(32),
    code_challenge: pkceChallenge(),
    code_challenge_method: 'S256',
    ...overrides,
  };
}

export function buildConsentApprove(
  overrides?: Partial<Extract<ConsentInput, { decision: 'approve' }>>,
) {
  return {
    client_id: faker.string.alphanumeric(32),
    scope: 'openid profile email',
    decision: 'approve' as const,
    state: faker.string.alphanumeric(32),
    redirect_uri: 'https://example.com/callback',
    code_challenge: pkceChallenge(),
    code_challenge_method: 'S256' as const,
    ...overrides,
  };
}

export function buildConsentDeny(overrides?: Partial<Extract<ConsentInput, { decision: 'deny' }>>) {
  return {
    client_id: faker.string.alphanumeric(32),
    scope: 'openid profile email',
    decision: 'deny' as const,
    state: faker.string.alphanumeric(32),
    redirect_uri: 'https://example.com/callback',
    ...overrides,
  };
}

export function buildTokenRequestAuthCode(
  overrides?: Partial<Extract<TokenRequestInput, { grant_type: 'authorization_code' }>>,
): Extract<TokenRequestInput, { grant_type: 'authorization_code' }> {
  return {
    grant_type: 'authorization_code',
    code: faker.string.alphanumeric(32),
    redirect_uri: 'https://example.com/callback',
    code_verifier: pkceVerifier(),
    ...overrides,
  };
}

export function buildTokenRequestRefresh(
  overrides?: Partial<Extract<TokenRequestInput, { grant_type: 'refresh_token' }>>,
): Extract<TokenRequestInput, { grant_type: 'refresh_token' }> {
  return {
    grant_type: 'refresh_token',
    refresh_token: faker.string.alphanumeric(43),
    ...overrides,
  };
}
