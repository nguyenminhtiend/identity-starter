import { sql } from 'drizzle-orm';
import { boolean, pgTable, timestamp, uuid, varchar } from 'drizzle-orm/pg-core';

export const loginAttempts = pgTable('login_attempts', {
  id: uuid('id').primaryKey().default(sql`uuidv7()`),
  email: varchar('email', { length: 255 }).notNull(),
  ipAddress: varchar('ip_address', { length: 45 }).notNull(),
  success: boolean('success').notNull(),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
});
