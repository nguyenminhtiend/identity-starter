import { getTableColumns, sql } from 'drizzle-orm';
import { pgTable, text, timestamp, uuid } from 'drizzle-orm/pg-core';
import { users } from './user.js';

export const sessions = pgTable('sessions', {
  id: uuid('id').primaryKey().default(sql`uuidv7()`),
  token: text('token').notNull().unique(),
  userId: uuid('user_id')
    .notNull()
    .references(() => users.id, { onDelete: 'cascade' }),
  expiresAt: timestamp('expires_at').notNull(),
  lastActiveAt: timestamp('last_active_at').notNull().defaultNow(),
  ipAddress: text('ip_address'),
  userAgent: text('user_agent'),
  createdAt: timestamp('created_at').notNull().defaultNow(),
});

const sessionColumns = getTableColumns(sessions);

export { sessionColumns };
