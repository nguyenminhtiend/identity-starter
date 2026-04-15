import { sql } from 'drizzle-orm';
import { index, jsonb, pgTable, timestamp, uuid, varchar } from 'drizzle-orm/pg-core';

export const auditLogs = pgTable(
  'audit_logs',
  {
    id: uuid('id').primaryKey().default(sql`uuidv7()`),
    actorId: uuid('actor_id'),
    action: varchar('action', { length: 100 }).notNull(),
    resourceType: varchar('resource_type', { length: 100 }).notNull(),
    resourceId: uuid('resource_id'),
    details: jsonb('details').notNull().default({}),
    ipAddress: varchar('ip_address', { length: 45 }),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    prevHash: varchar('prev_hash', { length: 64 }),
  },
  (t) => [
    index('audit_logs_actor_id_idx').on(t.actorId),
    index('audit_logs_action_idx').on(t.action),
    index('audit_logs_created_at_idx').on(t.createdAt),
  ],
);
