import type { FastifyInstance } from 'fastify';
import Fastify from 'fastify';
import { serializerCompiler, validatorCompiler } from 'fastify-type-provider-zod';
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import type { Container } from '../../../core/container-plugin.js';
import { errorHandlerPlugin } from '../../../core/plugins/error-handler.js';
import { InMemoryEventBus } from '../../../infra/event-bus.js';

const mocks = vi.hoisted(() => ({
  getJwks: vi.fn(),
}));

vi.mock('../../../core/env.js', () => ({
  env: {
    JWT_ISSUER: 'http://localhost:3000',
  },
}));

vi.mock('../../token/signing-key.service.js', () => ({
  createSigningKeyService: vi.fn(() => ({
    getJwks: mocks.getJwks,
    getActiveSigningKey: vi.fn(),
  })),
}));

import { discoveryRoutes } from '../discovery.routes.js';

describe('discovery routes', () => {
  let app: FastifyInstance;

  beforeAll(async () => {
    app = Fastify({ logger: false });
    app.setValidatorCompiler(validatorCompiler);
    app.setSerializerCompiler(serializerCompiler);

    app.decorate('container', {
      db: {} as unknown as Container['db'],
      eventBus: new InMemoryEventBus(),
    });

    await app.register(errorHandlerPlugin);
    await app.register(discoveryRoutes);
    await app.ready();
  });

  afterAll(async () => {
    await app.close();
  });

  beforeEach(() => {
    mocks.getJwks.mockReset();
  });

  describe('GET /.well-known/openid-configuration', () => {
    it('returns 200 with correct metadata', async () => {
      const response = await app.inject({
        method: 'GET',
        url: '/.well-known/openid-configuration',
      });

      expect(response.statusCode).toBe(200);
      expect(response.headers['access-control-allow-origin']).toBe('*');
      const body = JSON.parse(response.body);
      expect(body.issuer).toBe('http://localhost:3000');
      expect(body.authorization_endpoint).toBe('http://localhost:3000/oauth/authorize');
      expect(body.token_endpoint).toBe('http://localhost:3000/oauth/token');
      expect(body.userinfo_endpoint).toBe('http://localhost:3000/oauth/userinfo');
      expect(body.revocation_endpoint).toBe('http://localhost:3000/oauth/revoke');
      expect(body.introspection_endpoint).toBe('http://localhost:3000/oauth/introspect');
      expect(body.end_session_endpoint).toBe('http://localhost:3000/oauth/end-session');
      expect(body.pushed_authorization_request_endpoint).toBe('http://localhost:3000/oauth/par');
      expect(body.require_pushed_authorization_requests).toBe(true);
      expect(body.jwks_uri).toBe('http://localhost:3000/.well-known/jwks.json');
      expect(body.response_types_supported).toEqual(['code']);
      expect(body.grant_types_supported).toEqual([
        'authorization_code',
        'refresh_token',
        'client_credentials',
      ]);
      expect(body.dpop_signing_alg_values_supported).toEqual(['ES256', 'RS256']);
      expect(body.introspection_endpoint_auth_methods_supported).toEqual([
        'client_secret_basic',
        'client_secret_post',
      ]);
      expect(body.revocation_endpoint_auth_methods_supported).toEqual([
        'client_secret_basic',
        'client_secret_post',
      ]);
      expect(body.token_endpoint_auth_methods_supported).toEqual([
        'client_secret_basic',
        'client_secret_post',
      ]);
      expect(body.code_challenge_methods_supported).toEqual(['S256']);
    });
  });

  describe('GET /.well-known/jwks.json', () => {
    it('returns 200 with JWKS from signing key service', async () => {
      const jwks = {
        keys: [{ kid: 'k1', kty: 'RSA', n: 'abc', e: 'AQAB', use: 'sig', alg: 'RS256' }],
      };
      mocks.getJwks.mockResolvedValue(jwks);

      const response = await app.inject({
        method: 'GET',
        url: '/.well-known/jwks.json',
      });

      expect(response.statusCode).toBe(200);
      expect(response.headers['access-control-allow-origin']).toBe('*');
      expect(JSON.parse(response.body)).toEqual(jwks);
      expect(mocks.getJwks).toHaveBeenCalled();
    });
  });
});
