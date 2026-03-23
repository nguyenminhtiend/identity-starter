import type * as jose from 'jose';
import { api } from './helpers/http-client.js';

describe('Health & Discovery', () => {
  it('GET /health returns ok', async () => {
    const res = await api.get<{ status: string }>('/health');

    expect(res.status).toBe(200);
    expect(res.data.status).toBe('ok');
  });

  it('GET /.well-known/openid-configuration returns valid OIDC metadata', async () => {
    const res = await api.get<{
      issuer: string;
      authorization_endpoint: string;
      token_endpoint: string;
      userinfo_endpoint: string;
      jwks_uri: string;
      response_types_supported: string[];
      grant_types_supported: string[];
    }>('/.well-known/openid-configuration');

    expect(res.status).toBe(200);
    expect(res.data.issuer).toBe('http://localhost:3001');
    expect(res.data.authorization_endpoint).toContain('/oauth/authorize');
    expect(res.data.token_endpoint).toContain('/oauth/token');
    expect(res.data.userinfo_endpoint).toContain('/oauth/userinfo');
    expect(res.data.jwks_uri).toContain('/.well-known/jwks.json');
    expect(res.data.response_types_supported).toEqual(['code']);
    expect(res.data.grant_types_supported).toContain('authorization_code');
  });

  it('GET /.well-known/jwks.json returns valid JWKS structure', async () => {
    const res = await api.get<{ keys: jose.JWK[] }>('/.well-known/jwks.json');

    expect(res.status).toBe(200);
    expect(Array.isArray(res.data.keys)).toBe(true);
  });
});
