import { DomainError, ValidationError } from '@identity-starter/core';
import fp from 'fastify-plugin';
import { ZodError } from 'zod';

const STATUS_MAP: Record<string, number> = {
  NOT_FOUND: 404,
  CONFLICT: 409,
  VALIDATION_ERROR: 400,
};

export const errorHandlerPlugin = fp(async (fastify) => {
  fastify.setErrorHandler((err, request, reply) => {
    if (err instanceof ZodError) {
      return reply.code(400).send({
        error: 'Validation Error',
        code: 'VALIDATION_ERROR',
        details: err.issues,
      });
    }

    if (err instanceof DomainError) {
      const statusCode = STATUS_MAP[err.code] ?? 500;
      return reply.code(statusCode).send({
        error: err.message,
        code: err.code,
        ...(err instanceof ValidationError && { fields: err.fields }),
      });
    }

    request.log.error({ err }, 'Unhandled error');
    return reply.code(500).send({ error: 'Internal Server Error' });
  });

  fastify.setNotFoundHandler((request, reply) => {
    reply.code(404).send({
      error: 'Not Found',
      code: 'ROUTE_NOT_FOUND',
      message: `Route ${request.method} ${request.url} not found`,
    });
  });
});
