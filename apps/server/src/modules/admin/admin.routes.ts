import type { FastifyPluginAsyncZod } from 'fastify-type-provider-zod';
import {
  assignRoleSchema,
  createRoleSchema,
  roleIdParamSchema,
  roleListResponseSchema,
  roleSchema,
  setRolePermissionsSchema,
  userRoleParamsSchema,
} from '../rbac/rbac.schemas.js';
import {
  assignRole,
  createRole,
  listRoles,
  removeRole,
  setRolePermissions,
} from '../rbac/rbac.service.js';
import {
  adminUserSchema,
  messageResponseSchema,
  sessionIdParamSchema,
  sessionListQuerySchema,
  sessionListResponseSchema,
  updateUserStatusSchema,
  userIdParamSchema,
  userListQuerySchema,
  userListResponseSchema,
} from './admin.schemas.js';
import {
  bulkRevokeSessions,
  getUser,
  listSessions,
  listUsers,
  revokeSession,
  updateUserStatus,
} from './admin.service.js';

export const adminRoutes: FastifyPluginAsyncZod = async (fastify) => {
  const { db, eventBus } = fastify.container;

  // --- User Management ---
  fastify.get(
    '/users',
    {
      preHandler: fastify.requirePermission('users', 'read'),
      schema: {
        querystring: userListQuerySchema,
        response: { 200: userListResponseSchema },
      },
    },
    async (request) => {
      return listUsers(db, request.query);
    },
  );

  fastify.get(
    '/users/:id',
    {
      preHandler: fastify.requirePermission('users', 'read'),
      schema: {
        params: userIdParamSchema,
        response: { 200: adminUserSchema },
      },
    },
    async (request) => {
      return getUser(db, request.params.id);
    },
  );

  fastify.patch(
    '/users/:id/status',
    {
      preHandler: fastify.requirePermission('users', 'write'),
      schema: {
        params: userIdParamSchema,
        body: updateUserStatusSchema,
        response: { 200: adminUserSchema },
      },
    },
    async (request) => {
      return updateUserStatus(db, eventBus, request.params.id, request.body, request.userId);
    },
  );

  // --- Role Management ---
  fastify.post(
    '/roles',
    {
      preHandler: fastify.requirePermission('roles', 'write'),
      schema: {
        body: createRoleSchema,
        response: { 201: roleSchema },
      },
    },
    async (request, reply) => {
      const role = await createRole(db, eventBus, request.body);
      return reply.status(201).send(role);
    },
  );

  fastify.get(
    '/roles',
    {
      preHandler: fastify.requirePermission('roles', 'read'),
      schema: {
        response: { 200: roleListResponseSchema },
      },
    },
    async () => {
      return listRoles(db);
    },
  );

  fastify.put(
    '/roles/:id/permissions',
    {
      preHandler: fastify.requirePermission('roles', 'write'),
      schema: {
        params: roleIdParamSchema,
        body: setRolePermissionsSchema,
        response: { 200: messageResponseSchema },
      },
    },
    async (request) => {
      await setRolePermissions(db, eventBus, request.params.id, request.body.permissionIds);
      return { message: 'Permissions updated' };
    },
  );

  fastify.post(
    '/users/:id/roles',
    {
      preHandler: fastify.requirePermission('roles', 'write'),
      schema: {
        params: userIdParamSchema,
        body: assignRoleSchema,
        response: { 201: messageResponseSchema },
      },
    },
    async (request, reply) => {
      await assignRole(db, eventBus, request.params.id, request.body.roleId, request.userId);
      return reply.status(201).send({ message: 'Role assigned' });
    },
  );

  fastify.delete(
    '/users/:id/roles/:roleId',
    {
      preHandler: fastify.requirePermission('roles', 'write'),
      schema: {
        params: userRoleParamsSchema,
      },
    },
    async (request, reply) => {
      await removeRole(db, eventBus, request.params.id, request.params.roleId, request.userId);
      return reply.status(204).send();
    },
  );

  // --- Session Management ---
  fastify.get(
    '/sessions',
    {
      preHandler: fastify.requirePermission('sessions', 'read'),
      schema: {
        querystring: sessionListQuerySchema,
        response: { 200: sessionListResponseSchema },
      },
    },
    async (request) => {
      return listSessions(db, request.query);
    },
  );

  fastify.delete(
    '/sessions/:id',
    {
      preHandler: fastify.requirePermission('sessions', 'write'),
      schema: {
        params: sessionIdParamSchema,
      },
    },
    async (request, reply) => {
      await revokeSession(db, eventBus, request.params.id, request.userId);
      return reply.status(204).send();
    },
  );

  fastify.delete(
    '/users/:id/sessions',
    {
      preHandler: fastify.requirePermission('sessions', 'write'),
      schema: {
        params: userIdParamSchema,
        response: { 200: messageResponseSchema },
      },
    },
    async (request) => {
      const result = await bulkRevokeSessions(db, eventBus, request.params.id, request.userId);
      return { message: `Revoked ${result.revoked} sessions` };
    },
  );
};
