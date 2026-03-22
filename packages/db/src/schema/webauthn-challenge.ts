import { sql } from 'drizzle-orm';
import { pgEnum, pgTable, text, timestamp, uuid } from 'drizzle-orm/pg-core';
import { users } from './user.js';

export const challengeTypeEnum = pgEnum('challenge_type', ['registration', 'authentication']);

export const webauthnChallenges = pgTable('webauthn_challenges', {
  id: uuid('id').primaryKey().default(sql`uuidv7()`),
  userId: uuid('user_id').references(() => users.id, { onDelete: 'cascade' }),
  challenge: text('challenge').notNull().unique(),
  type: challengeTypeEnum('type').notNull(),
  expiresAt: timestamp('expires_at', { withTimezone: true }).notNull(),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
});
