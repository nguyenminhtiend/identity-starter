import type { FastifyReply, FastifyRequest } from 'fastify';
import { z } from 'zod';

interface ValidateSchemas {
  body?: z.ZodType;
  params?: z.ZodType;
  querystring?: z.ZodType;
}

export function validate(schemas: ValidateSchemas) {
  return async (request: FastifyRequest, reply: FastifyReply) => {
    try {
      if (schemas.params) {
        request.params = schemas.params.parse(request.params);
      }
      if (schemas.body) {
        request.body = schemas.body.parse(request.body);
      }
      if (schemas.querystring) {
        request.query = schemas.querystring.parse(request.query);
      }
    } catch (error) {
      if (error instanceof z.ZodError) {
        return reply.status(400).send({
          error: 'Validation failed',
          details: z.flattenError(error).fieldErrors,
        });
      }
      throw error;
    }
  };
}
