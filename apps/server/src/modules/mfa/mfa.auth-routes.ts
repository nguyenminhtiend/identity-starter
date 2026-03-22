import type { FastifyPluginAsyncZod } from 'fastify-type-provider-zod';
import { env } from '../../core/env.js';
import { setSessionCookie } from '../../core/plugins/auth.js';
import { mfaVerifyResponseSchema, mfaVerifySchema } from './mfa.schemas.js';
import { createMfaService } from './mfa.service.js';

export const mfaAuthRoutes: FastifyPluginAsyncZod = async (fastify) => {
  const { db, eventBus } = fastify.container;
  const mfaService = createMfaService({ db, eventBus });

  fastify.post(
    '/verify',
    {
      schema: {
        body: mfaVerifySchema,
        response: { 200: mfaVerifyResponseSchema },
      },
      config: { rateLimit: { max: 10, timeWindow: '15 minutes' } },
    },
    async (request, reply) => {
      const result = await mfaService.verifyMfaChallenge(request.body, {
        ipAddress: request.ip,
        userAgent: request.headers['user-agent'],
      });
      setSessionCookie(reply, result.token, env.SESSION_TTL_SECONDS);
      return reply.send(result);
    },
  );
};
