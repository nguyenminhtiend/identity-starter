import { getTableColumns, sql } from 'drizzle-orm';
import { boolean, pgTable, text, timestamp, uuid } from 'drizzle-orm/pg-core';
import { users } from './user.js';

export const totpSecrets = pgTable('totp_secrets', {
  id: uuid('id').primaryKey().default(sql`uuidv7()`),
  userId: uuid('user_id')
    .notNull()
    .unique()
    .references(() => users.id, { onDelete: 'cascade' }),
  secret: text('secret').notNull(),
  verified: boolean('verified').notNull().default(false),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
});

export const totpSecretColumns = getTableColumns(totpSecrets);
