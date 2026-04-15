import { getTableColumns, sql } from 'drizzle-orm';
import { index, pgTable, text, timestamp, uuid } from 'drizzle-orm/pg-core';
import { users } from './user.js';

export const sessions = pgTable(
  'sessions',
  {
    id: uuid('id').primaryKey().default(sql`uuidv7()`),
    token: text('token').notNull().unique(),
    userId: uuid('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    expiresAt: timestamp('expires_at', { withTimezone: true }).notNull(),
    lastActiveAt: timestamp('last_active_at', { withTimezone: true }).notNull().defaultNow(),
    ipAddress: text('ip_address'),
    userAgent: text('user_agent'),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [index('sessions_user_id_idx').on(t.userId)],
);

const sessionColumns = getTableColumns(sessions);

export { sessionColumns };
