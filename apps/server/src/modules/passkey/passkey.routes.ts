import type { AuthenticationResponseJSON, RegistrationResponseJSON } from '@simplewebauthn/server';
import type { FastifyPluginAsyncZod } from 'fastify-type-provider-zod';
import { env } from '../../core/env.js';
import { setSessionCookie } from '../../core/plugins/auth.js';
import {
  authenticationVerifyBodySchema,
  authResponseSchema,
  registrationVerifyBodySchema,
  registrationVerifyResponseSchema,
} from './passkey.schemas.js';
import { createPasskeyService } from './passkey.service.js';

export const passkeyRoutes: FastifyPluginAsyncZod = async (fastify) => {
  const { db, eventBus } = fastify.container;
  const passkeyService = createPasskeyService({ db, eventBus });

  fastify.post(
    '/register/options',
    {
      preHandler: fastify.requireSession,
      config: { rateLimit: { max: 10, timeWindow: '15 minutes' } },
    },
    async (request) => {
      return passkeyService.generateRegistrationOptions(request.userId);
    },
  );

  fastify.post(
    '/register/verify',
    {
      preHandler: fastify.requireSession,
      schema: {
        body: registrationVerifyBodySchema,
        response: { 201: registrationVerifyResponseSchema },
      },
      config: { rateLimit: { max: 10, timeWindow: '15 minutes' } },
    },
    async (request, reply) => {
      const body = request.body as unknown as RegistrationResponseJSON;
      const result = await passkeyService.verifyRegistration(request.userId, body);
      return reply.status(201).send(result);
    },
  );

  fastify.post(
    '/login/options',
    {
      config: { rateLimit: { max: 10, timeWindow: '15 minutes' } },
    },
    async () => {
      return passkeyService.generateAuthenticationOptions();
    },
  );

  fastify.post(
    '/login/verify',
    {
      schema: {
        body: authenticationVerifyBodySchema,
        response: { 200: authResponseSchema },
      },
      config: { rateLimit: { max: 10, timeWindow: '15 minutes' } },
    },
    async (request, reply) => {
      const body = request.body as unknown as AuthenticationResponseJSON;
      const result = await passkeyService.verifyAuthentication(body, {
        ipAddress: request.ip,
        userAgent: request.headers['user-agent'],
      });
      setSessionCookie(reply, result.token, env.SESSION_TTL_SECONDS);
      return reply.send(result);
    },
  );
};
