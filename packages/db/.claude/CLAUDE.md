# DB Package

Drizzle ORM database layer. Schema definitions, client factory, migration runner, and seed script.

## Commands

```bash
pnpm db:generate                # Generate Drizzle migrations from schema changes
pnpm db:migrate                 # Run pending migrations
pnpm db:seed                    # Seed database with initial data
```

## Directory Structure

```
src/
├── schema/                     # 24+ table definitions
│   ├── user.ts                 # users table + userColumns (excludes passwordHash)
│   ├── session.ts              # sessions with cascade delete on user
│   ├── role.ts                 # roles + permissions
│   ├── oauth-client.ts         # OAuth client registrations
│   ├── audit-log.ts            # Audit trail
│   └── ...                     # tokens, passkeys, etc.
├── client.ts                   # createDb(url) factory → { db, client }
├── index.ts                    # Barrel export (all tables + factory)
├── migrate.ts                  # CLI migration runner
└── seed.ts                     # Database seeding script
```

## Schema Conventions

- **UUID primary keys** — all tables use `uuid('id').primaryKey().default(sql\`uuidv7()\`)` for sortable IDs
- **Timezone-aware timestamps** — `timestamp(..., { withTimezone: true }).notNull().defaultNow()`
- **Selective column exports** — sensitive tables export a `*Columns` variant excluding secrets:
  ```typescript
  const { passwordHash: _, ...userColumns } = getTableColumns(users);
  export { userColumns };
  ```
- **Foreign key cascades** — sessions cascade on user deletion
- **Status enums** — inline: `['active', 'suspended', 'pending_verification']`
- **JSONB for metadata** — `metadata: jsonb('metadata').notNull().default({})`
- **Table naming** — singular lowercase (`user`, `session`, `role`)
- **Column naming** — snake_case

## Adding a New Table

1. Create schema file in `src/schema/`
2. Follow UUID + timestamp conventions above
3. Export from `src/index.ts`
4. Run `pnpm db:generate` then `pnpm db:migrate`

## Dependencies

`drizzle-orm`, `postgres` (postgres.js driver), `drizzle-kit` (dev)
