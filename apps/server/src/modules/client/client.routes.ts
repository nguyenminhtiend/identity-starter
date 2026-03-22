import type { FastifyPluginAsyncZod } from 'fastify-type-provider-zod';
import {
  clientIdParamSchema,
  clientListResponseSchema,
  clientResponseSchema,
  clientWithSecretResponseSchema,
  createClientSchema,
  rotateSecretResponseSchema,
  updateClientSchema,
} from './client.schemas.js';
import {
  createClient,
  deleteClient,
  getClient,
  listClients,
  rotateSecret,
  updateClient,
} from './client.service.js';

export const clientRoutes: FastifyPluginAsyncZod = async (fastify) => {
  const { db, eventBus } = fastify.container;

  fastify.addHook('onRequest', fastify.requireAdmin);

  fastify.post(
    '/',
    {
      schema: {
        body: createClientSchema,
        response: { 201: clientWithSecretResponseSchema },
      },
    },
    async (request, reply) => {
      const client = await createClient(db, eventBus, request.body);
      return reply.status(201).send(client);
    },
  );

  fastify.get(
    '/',
    {
      schema: {
        response: { 200: clientListResponseSchema },
      },
    },
    async () => {
      return listClients(db);
    },
  );

  fastify.get(
    '/:id',
    {
      schema: {
        params: clientIdParamSchema,
        response: { 200: clientResponseSchema },
      },
    },
    async (request) => {
      return getClient(db, request.params.id);
    },
  );

  fastify.patch(
    '/:id',
    {
      schema: {
        params: clientIdParamSchema,
        body: updateClientSchema,
        response: { 200: clientResponseSchema },
      },
    },
    async (request) => {
      return updateClient(db, eventBus, request.params.id, request.body);
    },
  );

  fastify.delete(
    '/:id',
    {
      schema: {
        params: clientIdParamSchema,
      },
    },
    async (request, reply) => {
      await deleteClient(db, eventBus, request.params.id);
      return reply.status(204).send();
    },
  );

  fastify.post(
    '/:id/rotate-secret',
    {
      schema: {
        params: clientIdParamSchema,
        response: { 200: rotateSecretResponseSchema },
      },
    },
    async (request) => {
      return rotateSecret(db, eventBus, request.params.id);
    },
  );
};
