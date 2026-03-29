import type * as jose from 'jose';
import { api } from './helpers/http-client.js';

describe('OIDC Discovery Deep Validation', () => {
  let metadata: Record<string, unknown>;

  it('fetches openid-configuration with all required OIDC fields', async () => {
    const res = await api.get<Record<string, unknown>>('/.well-known/openid-configuration');
    expect(res.status).toBe(200);
    metadata = res.data;

    expect(metadata.issuer).toBe('http://localhost:3001');
    expect(metadata.authorization_endpoint).toContain('/oauth/authorize');
    expect(metadata.token_endpoint).toContain('/oauth/token');
    expect(metadata.userinfo_endpoint).toContain('/oauth/userinfo');
    expect(metadata.jwks_uri).toContain('/.well-known/jwks.json');
    expect(metadata.revocation_endpoint).toContain('/oauth/revoke');
    expect(metadata.introspection_endpoint).toContain('/oauth/introspect');
    expect(metadata.end_session_endpoint).toContain('/oauth/end-session');
  });

  it('declares PKCE-only authorization code as response type', () => {
    expect(metadata.response_types_supported).toEqual(['code']);
  });

  it('supports required grant types', () => {
    const grants = metadata.grant_types_supported as string[];
    expect(grants).toContain('authorization_code');
    expect(grants).toContain('refresh_token');
    expect(grants).toContain('client_credentials');
  });

  it('declares scopes_supported including openid', () => {
    const scopes = metadata.scopes_supported as string[];
    expect(scopes).toContain('openid');
    expect(scopes).toContain('profile');
    expect(scopes).toContain('email');
  });

  it('declares code_challenge_methods_supported with S256', () => {
    const methods = metadata.code_challenge_methods_supported as string[];
    expect(methods).toContain('S256');
  });

  it('declares token_endpoint_auth_methods_supported', () => {
    const methods = metadata.token_endpoint_auth_methods_supported as string[];
    expect(methods).toBeDefined();
    expect(methods.length).toBeGreaterThan(0);
    expect(methods).toContain('client_secret_basic');
  });

  it('declares id_token_signing_alg_values_supported', () => {
    const algs = metadata.id_token_signing_alg_values_supported as string[];
    expect(algs).toBeDefined();
    expect(algs.length).toBeGreaterThan(0);
  });

  it('declares subject_types_supported', () => {
    const types = metadata.subject_types_supported as string[];
    expect(types).toBeDefined();
    expect(types).toContain('public');
  });

  it('JWKS contains at least one key with required fields', async () => {
    const res = await api.get<{ keys: jose.JWK[] }>('/.well-known/jwks.json');
    expect(res.status).toBe(200);
    expect(res.data.keys.length).toBeGreaterThan(0);

    const key = res.data.keys[0];
    expect(key.kty).toBeDefined();
    expect(key.kid).toBeDefined();
    expect(key.use).toBe('sig');
    expect(key.alg).toBeDefined();
  });

  it('PAR endpoint is declared in metadata', () => {
    expect(metadata.pushed_authorization_request_endpoint).toContain('/oauth/par');
  });
});
