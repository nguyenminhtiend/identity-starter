import type { FastifyPluginAsyncZod } from 'fastify-type-provider-zod';
import {
  passkeyIdParamSchema,
  passkeyListResponseSchema,
  profileResponseSchema,
  renamePasskeyResponseSchema,
  renamePasskeySchema,
  sessionIdParamSchema,
  sessionListResponseSchema,
  updateProfileResponseSchema,
  updateProfileSchema,
} from './account.schemas.js';
import {
  deletePasskey,
  getProfile,
  listPasskeys,
  listSessions,
  renamePasskey,
  revokeOwnSession,
  updateProfile,
} from './account.service.js';

export const accountRoutes: FastifyPluginAsyncZod = async (fastify) => {
  const { db, eventBus } = fastify.container;

  fastify.get(
    '/profile',
    {
      preHandler: fastify.requireSession,
      schema: {
        response: { 200: profileResponseSchema },
      },
    },
    async (request) => {
      return getProfile(db, request.userId);
    },
  );

  fastify.patch(
    '/profile',
    {
      preHandler: fastify.requireSession,
      schema: {
        body: updateProfileSchema,
        response: { 200: updateProfileResponseSchema },
      },
    },
    async (request) => {
      return updateProfile(db, eventBus, request.userId, request.body);
    },
  );

  fastify.get(
    '/sessions',
    {
      preHandler: fastify.requireSession,
      schema: {
        response: { 200: sessionListResponseSchema },
      },
    },
    async (request) => {
      return listSessions(db, request.userId, request.session.id);
    },
  );

  fastify.delete(
    '/sessions/:id',
    {
      preHandler: fastify.requireSession,
      schema: {
        params: sessionIdParamSchema,
      },
    },
    async (request, reply) => {
      await revokeOwnSession(db, eventBus, request.userId, request.params.id, request.session.id);
      return reply.status(204).send();
    },
  );

  fastify.get(
    '/passkeys',
    {
      preHandler: fastify.requireSession,
      schema: {
        response: { 200: passkeyListResponseSchema },
      },
    },
    async (request) => {
      return listPasskeys(db, request.userId);
    },
  );

  fastify.patch(
    '/passkeys/:id',
    {
      preHandler: fastify.requireSession,
      schema: {
        params: passkeyIdParamSchema,
        body: renamePasskeySchema,
        response: { 200: renamePasskeyResponseSchema },
      },
    },
    async (request) => {
      return renamePasskey(db, eventBus, request.userId, request.params.id, request.body.name);
    },
  );

  fastify.delete(
    '/passkeys/:id',
    {
      preHandler: fastify.requireSession,
      schema: {
        params: passkeyIdParamSchema,
      },
    },
    async (request, reply) => {
      await deletePasskey(db, eventBus, request.userId, request.params.id);
      return reply.status(204).send();
    },
  );
};
