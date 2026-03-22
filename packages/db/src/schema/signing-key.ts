import { getTableColumns, sql } from 'drizzle-orm';
import { jsonb, pgTable, text, timestamp, uuid } from 'drizzle-orm/pg-core';

export const signingKeys = pgTable('signing_keys', {
  id: uuid('id').primaryKey().default(sql`uuidv7()`),
  kid: text('kid').notNull().unique(),
  algorithm: text('algorithm').notNull().default('RS256'),
  publicKeyJwk: jsonb('public_key_jwk').notNull(),
  privateKeyJwk: jsonb('private_key_jwk').notNull(),
  status: text('status', { enum: ['active', 'rotated', 'revoked'] })
    .notNull()
    .default('active'),
  expiresAt: timestamp('expires_at', { withTimezone: true }),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
});

const signingKeyColumns = getTableColumns(signingKeys);

export { signingKeyColumns };
