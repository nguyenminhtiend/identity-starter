import { boolean, jsonb, pgTable, text, timestamp, uuid } from 'drizzle-orm/pg-core';

export const users = pgTable('users', {
  id: uuid('id').primaryKey(),
  email: text('email').notNull().unique(),
  emailVerified: boolean('email_verified').notNull().default(false),
  passwordHash: text('password_hash'),
  displayName: text('display_name').notNull(),
  status: text('status', { enum: ['active', 'suspended', 'pending_verification'] })
    .notNull()
    .default('pending_verification'),
  metadata: jsonb('metadata').notNull().default({}),
  createdAt: timestamp('created_at').notNull().defaultNow(),
  updatedAt: timestamp('updated_at').notNull().defaultNow(),
});
