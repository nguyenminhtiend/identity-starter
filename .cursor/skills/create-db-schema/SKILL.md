---
name: create-db-schema
description: >-
  Create Drizzle ORM database schemas in this identity-starter project. Use when
  adding new database tables, defining columns with advanced types (bytea, text
  arrays, foreign keys), creating indexes, or generating migrations. Also trigger
  when the user says "add table", "create schema", "DB migration", "add column",
  "foreign key", "database schema", or needs to define a new entity in
  packages/db/src/schema/. Covers column types, relations, indexes, custom types,
  safe column exports, and migration generation.
---

# Create DB Schema Skill

Define Drizzle ORM database schemas in `packages/db/src/schema/` and generate
migrations. This project uses PostgreSQL with `drizzle-orm` and `postgres` driver.

## Before Writing

1. Read `packages/db/src/schema/` to see existing schemas and avoid conflicts
2. Read `packages/db/src/client.ts` to understand the DB setup
3. Read `packages/db/drizzle.config.ts` for migration configuration
4. Check `packages/db/src/index.ts` to understand what's exported

## File Location

All schemas live in `packages/db/src/schema/`:

```
packages/db/src/schema/
  index.ts       ← barrel export for all schemas
  user.ts        ← existing
  session.ts     ← new tables go here
  passkey.ts     ← one file per entity/domain
```

## Column Types Reference

### Standard columns

```typescript
import { boolean, integer, jsonb, pgTable, text, timestamp, uuid } from 'drizzle-orm/pg-core';
import { sql } from 'drizzle-orm';

export const example = pgTable('examples', {
  // UUID v7 primary key (time-ordered, globally unique)
  id: uuid('id').primaryKey().default(sql`uuidv7()`),

  // Text columns
  name: text('name').notNull(),
  description: text('description'),                // nullable by default
  status: text('status', { enum: ['active', 'inactive'] }).notNull().default('active'),

  // Boolean
  isVerified: boolean('is_verified').notNull().default(false),

  // Integer
  counter: integer('counter').notNull().default(0),

  // JSONB (for flexible metadata)
  metadata: jsonb('metadata').notNull().default({}),

  // Timestamps
  createdAt: timestamp('created_at').notNull().defaultNow(),
  updatedAt: timestamp('updated_at').notNull().defaultNow(),
  expiresAt: timestamp('expires_at'),              // nullable for optional expiry
});
```

### Naming conventions

- **Table names**: lowercase plural (`users`, `sessions`, `passkeys`)
- **Column names in DB**: snake_case (`created_at`, `user_id`, `credential_id`)
- **Column names in code**: camelCase via Drizzle mapping (`createdAt`, `userId`)
- **File names**: singular (`user.ts`, `session.ts`, `passkey.ts`)

### UUID v7 primary key

Every table uses UUID v7 as the primary key. It's time-ordered (sortable by creation time)
and globally unique. The `uuidv7()` function must be available in PostgreSQL — it's provided
by the `pg_uuidv7` extension or a custom SQL function in the migration.

```typescript
id: uuid('id').primaryKey().default(sql`uuidv7()`),
```

### Foreign keys

```typescript
import { users } from './user.js';

export const sessions = pgTable('sessions', {
  // ...
  userId: uuid('user_id')
    .notNull()
    .references(() => users.id, { onDelete: 'cascade' }),
});
```

`onDelete` options:
- `'cascade'`: Delete child rows when parent is deleted (use for owned resources like sessions, passkeys)
- `'set null'`: Set FK to null (use when the relationship is optional)
- `'restrict'`: Prevent parent deletion if children exist (use for critical references)

### Unique constraints and indexes

For a unique column:
```typescript
credentialId: text('credential_id').notNull().unique(),
token: text('token').notNull().unique(),
email: text('email').notNull().unique(),
```

Drizzle creates a unique index automatically for `.unique()` columns.

### Text arrays (PostgreSQL `text[]`)

```typescript
transports: text('transports').array(),
```

This maps to PostgreSQL `text[]`. In TypeScript, the type is `string[] | null`.

### Bytea (binary data)

PostgreSQL `bytea` is not directly supported by Drizzle's built-in types. Use a
custom type for storing binary data like cryptographic keys:

```typescript
import { customType } from 'drizzle-orm/pg-core';

const bytea = customType<{ data: Uint8Array; driverParam: Buffer }>({
  dataType() {
    return 'bytea';
  },
  toDriver(value: Uint8Array): Buffer {
    return Buffer.from(value);
  },
  fromDriver(value: Buffer): Uint8Array {
    return new Uint8Array(value);
  },
});

// Usage
publicKey: bytea('public_key').notNull(),
```

The custom type handles `Uint8Array` ↔ `Buffer` conversion transparently:
- Application code uses `Uint8Array` (standard Web API type)
- The postgres driver receives/returns `Buffer` (Node.js native type)

Define the custom type once per schema file or in a shared `packages/db/src/schema/types.ts`.

## Safe Column Exports

Use `getTableColumns()` to create a safe subset that excludes sensitive fields:

```typescript
import { getTableColumns } from 'drizzle-orm';

export const users = pgTable('users', {
  id: uuid('id').primaryKey().default(sql`uuidv7()`),
  email: text('email').notNull().unique(),
  passwordHash: text('password_hash'),
  // ...
});

// Exclude passwordHash from default queries
const { passwordHash: _, ...userColumns } = getTableColumns(users);
export { userColumns };
```

Use `userColumns` in all `select()` calls that return data to clients.
Use the full table reference when internal code needs all columns:

```typescript
// Safe query (no password hash)
const [user] = await db.select(userColumns).from(users).where(eq(users.id, id));

// Internal query (includes password hash)
const [user] = await db.select().from(users).where(eq(users.email, email));
```

For tables without sensitive columns (like sessions), export all columns:

```typescript
const sessionColumns = getTableColumns(sessions);
export { sessionColumns };
```

## Row Type Inference

Drizzle provides type inference helpers:

```typescript
// Full row type (all columns, as returned by SELECT *)
type SessionRow = typeof sessions.$inferSelect;

// Insert type (columns needed for INSERT)
type SessionInsert = typeof sessions.$inferInsert;

// Safe columns type (for mapping to domain types)
type SafeRow = typeof sessionColumns;
type SafeRowResult = { [K in keyof SafeRow]: SafeRow[K]['_']['data'] };
```

Use `SafeRowResult` as the parameter type for row mapping functions:

```typescript
function mapToSession(row: SafeRowResult): Session {
  return {
    id: row.id,
    token: row.token,
    userId: row.userId,
    expiresAt: row.expiresAt,
    // ...
  };
}
```

## Barrel Exports

After creating a schema file, export from `packages/db/src/schema/index.ts`:

```typescript
export { userColumns, users } from './user.js';
export { sessionColumns, sessions } from './session.js';
export { passkeys, passkeyColumns } from './passkey.js';
```

And ensure `packages/db/src/index.ts` re-exports:

```typescript
export { createDb, type Database } from './client.js';
export { sessionColumns, sessions, userColumns, users, passkeys, passkeyColumns } from './schema/index.js';
```

The `client.ts` imports `* as schema` from the schema index, so new tables are
automatically included in the Drizzle client — no changes needed there.

## Generating Migrations

After creating or modifying schemas:

```bash
pnpm db:generate
```

This generates a SQL migration file in `packages/db/drizzle/`.

Verify the generated migration:
1. Open the `.sql` file and review the DDL statements
2. Check that column types match expectations (e.g., `bytea` not `text` for binary data)
3. Check that foreign keys and indexes are correct
4. Check that `uuidv7()` function exists or is created in the migration

Apply the migration:

```bash
pnpm db:migrate
```

## Complete Example: Sessions Table

```typescript
import { getTableColumns, sql } from 'drizzle-orm';
import { pgTable, text, timestamp, uuid } from 'drizzle-orm/pg-core';
import { users } from './user.js';

export const sessions = pgTable('sessions', {
  id: uuid('id').primaryKey().default(sql`uuidv7()`),
  token: text('token').notNull().unique(),
  userId: uuid('user_id').notNull().references(() => users.id, { onDelete: 'cascade' }),
  expiresAt: timestamp('expires_at').notNull(),
  ipAddress: text('ip_address'),
  userAgent: text('user_agent'),
  createdAt: timestamp('created_at').notNull().defaultNow(),
});

const sessionColumns = getTableColumns(sessions);
export { sessionColumns };
```

## Complete Example: Passkeys Table

```typescript
import { getTableColumns, sql } from 'drizzle-orm';
import { boolean, customType, integer, pgTable, text, timestamp, uuid } from 'drizzle-orm/pg-core';
import { users } from './user.js';

const bytea = customType<{ data: Uint8Array; driverParam: Buffer }>({
  dataType() {
    return 'bytea';
  },
  toDriver(value: Uint8Array): Buffer {
    return Buffer.from(value);
  },
  fromDriver(value: Buffer): Uint8Array {
    return new Uint8Array(value);
  },
});

export const passkeys = pgTable('passkeys', {
  id: uuid('id').primaryKey().default(sql`uuidv7()`),
  userId: uuid('user_id').notNull().references(() => users.id, { onDelete: 'cascade' }),
  credentialId: text('credential_id').notNull().unique(),
  publicKey: bytea('public_key').notNull(),
  counter: integer('counter').notNull().default(0),
  deviceType: text('device_type').notNull(),
  backedUp: boolean('backed_up').notNull().default(false),
  transports: text('transports').array(),
  name: text('name'),
  createdAt: timestamp('created_at').notNull().defaultNow(),
});

const { publicKey: _, ...passkeyColumns } = getTableColumns(passkeys);
export { passkeyColumns };
```

Here `publicKey` is excluded from `passkeyColumns` — the raw COSE public key
bytes don't need to be returned to clients. Only the service layer uses the full
table for credential verification.

## Checklist

- [ ] Schema file created at `packages/db/src/schema/<name>.ts`
- [ ] UUID v7 primary key with `default(sql\`uuidv7()\`)`
- [ ] Column names use snake_case in DB, camelCase in code
- [ ] Foreign keys defined with appropriate `onDelete` behavior
- [ ] Unique constraints on uniquely-identifying columns
- [ ] Custom types defined for non-standard PostgreSQL types (bytea, etc.)
- [ ] Safe columns exported (sensitive fields excluded via destructuring)
- [ ] Exported from `packages/db/src/schema/index.ts`
- [ ] Exported from `packages/db/src/index.ts`
- [ ] Migration generated with `pnpm db:generate`
- [ ] Migration SQL reviewed for correctness
- [ ] Migration applied with `pnpm db:migrate`
