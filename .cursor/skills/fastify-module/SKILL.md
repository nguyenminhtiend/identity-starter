---
name: fastify-module
description: >-
  Scaffold a new Fastify API module under apps/api/src/modules/. Use when creating
  a new feature module, REST resource, CRUD endpoints, or adding a new domain entity
  to the API. Follow this skill whenever the user asks to add a new module, resource,
  route group, or API endpoint set — even if they don't say "module" explicitly.
---

# Create a New Fastify Module

Every feature lives in its own directory under `apps/api/src/modules/<name>/`. This skill walks through scaffolding a complete module following the project's conventions.

## Module Structure

```
apps/api/src/modules/<name>/
├── index.ts              # Barrel exports (routes, service, schemas)
├── <name>.routes.ts      # Fastify route plugin
├── <name>.service.ts     # Business logic (pure functions, no framework imports)
├── <name>.schemas.ts     # Zod schemas + types
```

## Step-by-Step

### 1. Create Schemas (`<name>.schemas.ts`)

Define all Zod schemas and inferred types for the module. This is the single source of truth for input/output shapes.

```typescript
// modules/tasks/tasks.schemas.ts
import { z } from 'zod';

export const TaskSchema = z.object({
  id: z.string().uuid(),
  title: z.string().min(1),
  status: z.enum(['todo', 'in_progress', 'done']),
  assigneeId: z.string().uuid().nullable(),
  createdAt: z.date(),
  updatedAt: z.date(),
});

export const CreateTaskSchema = z.object({
  title: z.string().min(1, 'Title is required'),
  status: z.enum(['todo', 'in_progress', 'done']).default('todo'),
  assigneeId: z.string().uuid().nullable().optional(),
});

export const UpdateTaskSchema = CreateTaskSchema.partial();

export const TaskIdParamSchema = z.object({
  id: z.string().uuid('Invalid task ID format'),
});

export const ListTasksQuerySchema = z.object({
  limit: z.coerce.number().min(1).max(100).default(10),
  offset: z.coerce.number().min(0).default(0),
});

// Type exports
export type Task = z.infer<typeof TaskSchema>;
export type CreateTask = z.infer<typeof CreateTaskSchema>;
export type UpdateTask = z.infer<typeof UpdateTaskSchema>;
export type TaskIdParam = z.infer<typeof TaskIdParamSchema>;
export type ListTasksQuery = z.infer<typeof ListTasksQuerySchema>;
```

**Conventions:**
- Base schema mirrors the DB table columns
- `Create*Schema` — fields the client sends on POST
- `Update*Schema` — `.partial()` of create (PATCH semantics)
- `*IdParamSchema` — route param validation
- `List*QuerySchema` — pagination with defaults
- Export both schemas and inferred types

### 2. Create Service (`<name>.service.ts`)

Pure business logic. Takes `db` (from `@collab/db`) as first argument — no Fastify imports. Throw custom errors from `core/errors.ts`.

```typescript
// modules/tasks/tasks.service.ts
import { eq, count, desc } from 'drizzle-orm';
import { tasks } from '@collab/db';
import type { DbClient } from '@collab/db';
import { NotFoundError, ConflictError } from '../../core/errors';
import type { CreateTask, UpdateTask, ListTasksQuery } from './tasks.schemas';

export const getTaskById = async (db: DbClient, id: string) => {
  const result = await db.select().from(tasks).where(eq(tasks.id, id)).limit(1);
  if (!result[0]) throw new NotFoundError('Task', id);
  return result[0];
};

export const getAllTasks = async (db: DbClient, query: ListTasksQuery) => {
  const [tasksList, totalResult] = await Promise.all([
    db.select().from(tasks).orderBy(desc(tasks.createdAt)).limit(query.limit).offset(query.offset),
    db.select({ count: count() }).from(tasks),
  ]);

  return {
    tasks: tasksList,
    total: totalResult[0]?.count ?? 0,
    limit: query.limit,
    offset: query.offset,
  };
};

export const createTask = async (db: DbClient, data: CreateTask) => {
  const result = await db.insert(tasks).values(data).returning();
  return result[0]!;
};

export const updateTask = async (db: DbClient, id: string, data: UpdateTask) => {
  const current = await db.select().from(tasks).where(eq(tasks.id, id)).limit(1);
  if (!current[0]) throw new NotFoundError('Task', id);

  const result = await db
    .update(tasks)
    .set({ ...data, updatedAt: new Date() })
    .where(eq(tasks.id, id))
    .returning();

  return result[0]!;
};

export const deleteTask = async (db: DbClient, id: string) => {
  const result = await db.delete(tasks).where(eq(tasks.id, id)).returning();
  if (!result[0]) throw new NotFoundError('Task', id);
  return result[0];
};
```

**Conventions:**
- First param is always `db: DbClient`
- Export named functions, not a class
- Throw `NotFoundError`, `ConflictError`, etc. — the error handler plugin catches them
- Return the entity directly (not wrapped in `{ data: ... }`)
- Use `returning()` on insert/update/delete

### 3. Create Routes (`<name>.routes.ts`)

A Fastify **plugin** that registers routes. Access the container via `fastify.container` (decorated in core). Use Zod schemas for validation by converting to JSON Schema with `zod-to-json-schema`, or validate manually in the handler.

```typescript
// modules/tasks/tasks.routes.ts
import type { FastifyPluginAsync } from 'fastify';
import * as tasksService from './tasks.service';
import {
  CreateTaskSchema,
  UpdateTaskSchema,
  TaskIdParamSchema,
  ListTasksQuerySchema,
} from './tasks.schemas';

export const tasksRoutes: FastifyPluginAsync = async (fastify) => {
  const { db } = fastify.container;

  // GET / — list with pagination
  fastify.get('/', async (request, reply) => {
    const query = ListTasksQuerySchema.parse(request.query);
    const result = await tasksService.getAllTasks(db, query);
    return result;
  });

  // GET /:id
  fastify.get('/:id', async (request, reply) => {
    const { id } = TaskIdParamSchema.parse(request.params);
    const task = await tasksService.getTaskById(db, id);
    return task;
  });

  // POST /
  fastify.post('/', async (request, reply) => {
    const data = CreateTaskSchema.parse(request.body);
    const task = await tasksService.createTask(db, data);
    reply.code(201);
    return task;
  });

  // PATCH /:id
  fastify.patch('/:id', async (request, reply) => {
    const { id } = TaskIdParamSchema.parse(request.params);
    const data = UpdateTaskSchema.parse(request.body);
    const task = await tasksService.updateTask(db, id, data);
    return task;
  });

  // DELETE /:id
  fastify.delete('/:id', async (request, reply) => {
    const { id } = TaskIdParamSchema.parse(request.params);
    const task = await tasksService.deleteTask(db, id);
    return task;
  });
};
```

**Conventions:**
- Export a `FastifyPluginAsync` — NOT a function returning a Fastify instance
- Access `db` from `fastify.container` (decorated by core)
- Parse request data with Zod `.parse()` — validation errors are caught by the global error handler
- Return objects directly from handlers (Fastify serializes to JSON automatically)
- Use `reply.code(201)` for creation, return the entity
- Standard CRUD: `GET /`, `GET /:id`, `POST /`, `PATCH /:id`, `DELETE /:id`

### 4. Create Barrel Export (`index.ts`)

```typescript
// modules/tasks/index.ts
export { tasksRoutes } from './tasks.routes';
export * as tasksService from './tasks.service';
export * from './tasks.schemas';
```

### 5. Register in App

Add the module to `app.ts`:

```typescript
import { tasksRoutes } from './modules/tasks';

// inside buildApp():
await app.register(tasksRoutes, { prefix: '/api/tasks' });
```

The prefix sets the base path — routes inside the plugin are relative to it.

## Checklist for New Module

```
- [ ] Create <name>.schemas.ts with Zod schemas and type exports
- [ ] Create <name>.service.ts with business logic functions (db as first param)
- [ ] Create <name>.routes.ts as a FastifyPluginAsync
- [ ] Create index.ts barrel export
- [ ] Register routes in app.ts with prefix
- [ ] Add DB schema/table in @collab/db if new entity
- [ ] Generate and run Drizzle migration if schema changed
```

## Common Patterns

### Unique Constraint Check

```typescript
const existing = await db.select().from(items).where(eq(items.slug, data.slug)).limit(1);
if (existing[0]) throw new ConflictError(`Item with slug '${data.slug}' already exists`);
```

### Pagination Response Shape

Always return paginated lists in this shape:

```typescript
{
  <entities>: [...],
  total: number,
  limit: number,
  offset: number,
}
```

### Relations / Joins

Use Drizzle's relational queries or manual joins:

```typescript
const result = await db
  .select({ task: tasks, user: users })
  .from(tasks)
  .leftJoin(users, eq(tasks.assigneeId, users.id))
  .where(eq(tasks.id, id))
  .limit(1);
```

### Shared Types from `@collab/types`

If a schema is shared across API + server apps, define it in `@collab/types` and re-export in the module's schemas file:

```typescript
import { DocumentSchema, CreateDocumentSchema } from '@collab/types';
export { DocumentSchema, CreateDocumentSchema };
```

## Don'ts

- **Don't import Hono** — this project uses Fastify
- **Don't create a `new Hono()` inside routes** — export a `FastifyPluginAsync` instead
- **Don't inject `container` as a function param to routes** — use `fastify.container` from the decorated instance
- **Don't put framework logic in service files** — services are pure business logic with `db` as first param
- **Don't forget to register the module in `app.ts`** — unregistered plugins are dead code
