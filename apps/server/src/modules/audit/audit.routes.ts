import type { FastifyPluginAsyncZod } from 'fastify-type-provider-zod';
import {
  auditExportQuerySchema,
  auditLogListResponseSchema,
  auditLogQuerySchema,
} from './audit.schemas.js';
import { exportAuditLogs, queryAuditLogs } from './audit.service.js';

export const auditRoutes: FastifyPluginAsyncZod = async (fastify) => {
  const { db } = fastify.container;

  fastify.get(
    '/',
    {
      preHandler: fastify.requirePermission('audit', 'read'),
      schema: {
        querystring: auditLogQuerySchema,
        response: { 200: auditLogListResponseSchema },
      },
    },
    async (request) => {
      return queryAuditLogs(db, request.query);
    },
  );

  fastify.get(
    '/export',
    {
      preHandler: fastify.requirePermission('audit', 'export'),
      schema: {
        querystring: auditExportQuerySchema,
      },
    },
    async (request, reply) => {
      const logs = await exportAuditLogs(db, request.query);
      reply.header('content-type', 'application/x-ndjson');
      const ndjson = logs.map((log) => JSON.stringify(log)).join('\n');
      return reply.send(ndjson);
    },
  );
};
