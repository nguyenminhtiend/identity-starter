import { DomainError, TooManyRequestsError, ValidationError } from '@identity-starter/core';
import fp from 'fastify-plugin';
import { hasZodFastifySchemaValidationErrors } from 'fastify-type-provider-zod';
import { ZodError } from 'zod';

const STATUS_MAP: Record<string, number> = {
  NOT_FOUND: 404,
  CONFLICT: 409,
  VALIDATION_ERROR: 400,
  UNAUTHORIZED: 401,
  FORBIDDEN: 403,
  TOO_MANY_REQUESTS: 429,
};

export const errorHandlerPlugin = fp(async (fastify) => {
  fastify.setErrorHandler((err, request, reply) => {
    if (hasZodFastifySchemaValidationErrors(err)) {
      return reply.code(400).send({
        error: 'Validation Error',
        code: 'VALIDATION_ERROR',
        details: err.validation,
      });
    }

    if (err instanceof ZodError) {
      return reply.code(400).send({
        error: 'Validation Error',
        code: 'VALIDATION_ERROR',
        details: err.issues,
      });
    }

    if (err instanceof TooManyRequestsError) {
      reply.header('Retry-After', String(err.retryAfter));
      return reply.code(429).send({
        error: err.message,
        code: err.code,
        retryAfter: err.retryAfter,
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

    if (
      err instanceof Error &&
      'statusCode' in err &&
      typeof (err as Error & { statusCode: unknown }).statusCode === 'number'
    ) {
      const statusCode = (err as Error & { statusCode: number }).statusCode;
      if (statusCode >= 400 && statusCode < 600) {
        return reply.code(statusCode).send({ error: err.message });
      }
    }

    request.log.error({ err }, 'Unhandled error');
    return reply.code(500).send({ error: 'Internal Server Error' });
  });

  fastify.setNotFoundHandler((_request, reply) => {
    reply.code(404).send({
      error: 'Not Found',
      code: 'ROUTE_NOT_FOUND',
    });
  });
});
