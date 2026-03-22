import type { FastifyPluginAsyncZod } from 'fastify-type-provider-zod';
import { z } from 'zod';

import { env } from '../../core/env.js';
import { createSigningKeyService } from '../token/signing-key.service.js';

const openIdConfigurationResponseSchema = z.object({
  issuer: z.string(),
  authorization_endpoint: z.string(),
  token_endpoint: z.string(),
  userinfo_endpoint: z.string(),
  revocation_endpoint: z.string(),
  introspection_endpoint: z.string(),
  end_session_endpoint: z.string(),
  pushed_authorization_request_endpoint: z.string(),
  require_pushed_authorization_requests: z.boolean(),
  jwks_uri: z.string(),
  response_types_supported: z.array(z.string()),
  grant_types_supported: z.array(z.string()),
  subject_types_supported: z.array(z.string()),
  id_token_signing_alg_values_supported: z.array(z.string()),
  scopes_supported: z.array(z.string()),
  token_endpoint_auth_methods_supported: z.array(z.string()),
  code_challenge_methods_supported: z.array(z.string()),
  claims_supported: z.array(z.string()),
  dpop_signing_alg_values_supported: z.array(z.string()),
  introspection_endpoint_auth_methods_supported: z.array(z.string()),
  revocation_endpoint_auth_methods_supported: z.array(z.string()),
});

const jwksResponseSchema = z.object({
  keys: z.array(z.unknown()),
});

export const discoveryRoutes: FastifyPluginAsyncZod = async (fastify) => {
  const { db } = fastify.container;
  const signingKeyService = createSigningKeyService({ db });
  const issuer = env.JWT_ISSUER;
  const issuerBase = issuer.replace(/\/$/, '');

  fastify.addHook('onSend', async (_request, reply, payload) => {
    reply.header('Access-Control-Allow-Origin', '*');
    return payload;
  });

  fastify.get(
    '/.well-known/openid-configuration',
    {
      schema: {
        response: { 200: openIdConfigurationResponseSchema },
      },
    },
    async (_request, reply) => {
      return reply.status(200).send({
        issuer,
        authorization_endpoint: `${issuerBase}/oauth/authorize`,
        token_endpoint: `${issuerBase}/oauth/token`,
        userinfo_endpoint: `${issuerBase}/oauth/userinfo`,
        revocation_endpoint: `${issuerBase}/oauth/revoke`,
        introspection_endpoint: `${issuerBase}/oauth/introspect`,
        end_session_endpoint: `${issuerBase}/oauth/end-session`,
        pushed_authorization_request_endpoint: `${issuerBase}/oauth/par`,
        require_pushed_authorization_requests: false,
        jwks_uri: `${issuerBase}/.well-known/jwks.json`,
        response_types_supported: ['code'],
        grant_types_supported: ['authorization_code', 'refresh_token', 'client_credentials'],
        subject_types_supported: ['public'],
        id_token_signing_alg_values_supported: ['RS256'],
        scopes_supported: ['openid', 'profile', 'email'],
        token_endpoint_auth_methods_supported: ['client_secret_basic', 'client_secret_post'],
        code_challenge_methods_supported: ['S256'],
        dpop_signing_alg_values_supported: ['ES256', 'RS256'],
        introspection_endpoint_auth_methods_supported: [
          'client_secret_basic',
          'client_secret_post',
        ],
        revocation_endpoint_auth_methods_supported: ['client_secret_basic', 'client_secret_post'],
        claims_supported: [
          'sub',
          'iss',
          'aud',
          'exp',
          'iat',
          'nonce',
          'auth_time',
          'acr',
          'amr',
          'at_hash',
          'email',
          'email_verified',
          'name',
        ],
      });
    },
  );

  fastify.get(
    '/.well-known/jwks.json',
    {
      schema: {
        response: { 200: jwksResponseSchema },
      },
    },
    async (_request, reply) => {
      const jwks = await signingKeyService.getJwks();
      return reply.status(200).send(jwks);
    },
  );
};
