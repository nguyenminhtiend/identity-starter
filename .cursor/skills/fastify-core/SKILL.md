---
name: fastify-core
description: >-
  Build reusable core infrastructure for the Fastify API app under apps/api/src/core/.
  Use when creating or modifying shared utilities like container/DI, env config, logger,
  error classes, middleware, or any cross-cutting concerns. Use this skill whenever
  the user mentions core setup, container, DI, environment variables, logging,
  error handling, middleware, or shared infrastructure for the API.
---

# Fastify Core Infrastructure

Build all shared, reusable code under `apps/api/src/core/`. Every module depends on core — keep it lean, typed, and framework-aligned with Fastify.

## Tech Stack

| Concern | Library |
|---------|---------|
| HTTP framework | **Fastify** (with `@fastify/cors`, `@fastify/sensible`, etc.) |
| Validation | **Zod** + `zod-to-json-schema` (Fastify uses JSON Schema natively; convert Zod schemas) |
| Database | **Drizzle ORM** via `@collab/db` workspace package |
| Logging | **Pino** (built into Fastify — use `fastify.log`, not a standalone pino instance) |
| Env parsing | **Zod** |

## Directory Structure

```
apps/api/src/core/
├── index.ts              # Barrel re-exports
├── container.ts          # DI container (singleton)
├── env.ts                # Zod-validated environment
├── logger.ts             # Pino logger config for Fastify
├── errors.ts             # Custom error classes
└── plugins/              # Fastify plugins (reusable middleware)
    ├── error-handler.ts  # Global error handler plugin
    └── ...               # auth, rate-limit, etc.
```

## Container / Dependency Injection

Use a simple object container — no DI framework. The container holds shared resources (db, env, logger) and is decorated onto the Fastify instance.

```typescript
// core/container.ts
import { createDb } from '@collab/db';
import type { DbClient } from '@collab/db';
import { env, type Env } from './env';

export interface Container {
  db: DbClient;
  env: Env;
}

let instance: Container | null = null;

export const createContainer = (): Container => {
  if (instance) return instance;

  instance = {
    db: createDb(env.DATABASE_URL, {
      logger: env.LOG_SQL
        ? { logQuery: (query, params) => console.log('SQL', query, params) }
        : false,
    }),
    env,
  };

  return instance;
};

export const getContainer = (): Container => {
  if (!instance) throw new Error('Container not initialized');
  return instance;
};
```

Decorate the Fastify instance so plugins/routes can access it:

```typescript
// In app.ts or a plugin
import fp from 'fastify-plugin';

export const containerPlugin = fp(async (fastify, opts: { container: Container }) => {
  fastify.decorate('container', opts.container);
});

// Type augmentation
declare module 'fastify' {
  interface FastifyInstance {
    container: Container;
  }
}
```

## Environment Config

Parse and validate `process.env` with Zod at startup. Export both the parsed object and the inferred type.

```typescript
// core/env.ts
import { z } from 'zod';

const EnvSchema = z.object({
  NODE_ENV: z.enum(['development', 'production', 'test']).default('development'),
  PORT: z.coerce.number().default(3000),
  DATABASE_URL: z.url(),
  LOG_LEVEL: z.enum(['debug', 'info', 'warn', 'error']).default('info'),
  LOG_SQL: z
    .enum(['true', 'false'])
    .default('false')
    .transform((v) => v === 'true'),
});

export const env = EnvSchema.parse(process.env);
export type Env = z.infer<typeof EnvSchema>;
```

## Logger

Fastify ships with Pino built-in. Configure it when creating the Fastify instance — don't create a separate pino logger.

```typescript
// core/logger.ts
import type { FastifyServerOptions } from 'fastify';
import { env } from './env';

export const loggerConfig: FastifyServerOptions['logger'] = {
  level: env.LOG_LEVEL,
  transport:
    env.NODE_ENV === 'development'
      ? { target: 'pino-pretty', options: { colorize: true, translateTime: 'SYS:standard' } }
      : undefined,
  serializers: {
    req: (req) => ({ method: req.method, url: req.url }),
    res: (res) => ({ statusCode: res.statusCode }),
  },
};
```

Then in `app.ts`:

```typescript
import Fastify from 'fastify';
import { loggerConfig } from './core/logger';

const app = Fastify({ logger: loggerConfig });
```

## Error Classes

Custom error classes with status codes. Fastify's `reply.code().send()` pattern handles the rest.

```typescript
// core/errors.ts
export class AppError extends Error {
  constructor(
    message: string,
    public readonly statusCode: number = 500,
    public readonly code?: string,
  ) {
    super(message);
    this.name = 'AppError';
  }
}

export class NotFoundError extends AppError {
  constructor(resource: string, id?: string) {
    super(
      id ? `${resource} with id '${id}' not found` : `${resource} not found`,
      404,
      'NOT_FOUND',
    );
  }
}

export class ValidationError extends AppError {
  constructor(message: string, public readonly details?: unknown) {
    super(message, 400, 'VALIDATION_ERROR');
  }
}

export class ConflictError extends AppError {
  constructor(message: string) {
    super(message, 409, 'CONFLICT');
  }
}

export class UnauthorizedError extends AppError {
  constructor(message = 'Unauthorized') {
    super(message, 401, 'UNAUTHORIZED');
  }
}

export class ForbiddenError extends AppError {
  constructor(message = 'Forbidden') {
    super(message, 403, 'FORBIDDEN');
  }
}
```

## Plugins (Middleware)

Fastify uses the **plugin system** instead of middleware. Always wrap reusable plugins with `fastify-plugin` (`fp`) to share the encapsulation context.

### Global Error Handler Plugin

```typescript
// core/plugins/error-handler.ts
import fp from 'fastify-plugin';
import { AppError } from '../errors';
import { ZodError } from 'zod';

export const errorHandlerPlugin = fp(async (fastify) => {
  fastify.setErrorHandler((err, request, reply) => {
    if (err instanceof ZodError) {
      return reply.code(400).send({
        error: 'Validation Error',
        code: 'VALIDATION_ERROR',
        details: err.flatten(),
      });
    }

    if (err instanceof AppError) {
      return reply.code(err.statusCode).send({
        error: err.message,
        code: err.code,
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
```

### Creating New Plugins

Follow this pattern for any new plugin (auth, rate-limit, request-id, etc.):

```typescript
import fp from 'fastify-plugin';

export const myPlugin = fp(async (fastify, opts) => {
  // decorate, add hooks, register sub-routes, etc.
  fastify.addHook('onRequest', async (request, reply) => {
    // ...
  });
});
```

## App Bootstrap

Wire everything together in `app.ts`:

```typescript
// app.ts
import Fastify from 'fastify';
import cors from '@fastify/cors';
import { loggerConfig } from './core/logger';
import { containerPlugin } from './core/container';
import { errorHandlerPlugin } from './core/plugins/error-handler';
import { createContainer } from './core/container';
import { usersRoutes } from './modules/users';

export const buildApp = async () => {
  const container = createContainer();
  const app = Fastify({ logger: loggerConfig });

  // Core plugins
  await app.register(cors);
  await app.register(containerPlugin, { container });
  await app.register(errorHandlerPlugin);

  // Feature modules
  await app.register(usersRoutes, { prefix: '/api/users' });

  return app;
};
```

## Barrel Export

```typescript
// core/index.ts
export * from './env';
export * from './logger';
export * from './errors';
export * from './container';
```

## Conventions

- **Plugins over middleware** — Fastify's encapsulated plugin system replaces Express/Hono-style middleware.
- **`fp()` wrapper** — Always wrap shared plugins with `fastify-plugin` so decorators/hooks propagate.
- **Decorate, don't import singletons in routes** — attach shared resources to `fastify` instance via `decorate`.
- **JSON Schema for Fastify validation** — Fastify validates with JSON Schema natively. Use `zod-to-json-schema` to convert Zod schemas when registering route schemas.
- **`request.log`** — Use the request-scoped logger (`request.log.info(...)`) inside route handlers, not a global logger.
- **No `new Hono()`** — This project uses Fastify. Don't import from `hono`.
