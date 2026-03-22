import { sql } from 'drizzle-orm';
import { pgTable, text, timestamp, uuid } from 'drizzle-orm/pg-core';
import { oauthClients } from './oauth-client.js';

export const parRequests = pgTable('par_requests', {
  id: uuid('id').primaryKey().default(sql`uuidv7()`),
  requestUri: text('request_uri').notNull().unique(),
  clientId: uuid('client_id')
    .notNull()
    .references(() => oauthClients.id, { onDelete: 'cascade' }),
  parameters: text('parameters').notNull(), // JSON-encoded authorization params
  expiresAt: timestamp('expires_at', { withTimezone: true }).notNull(),
  usedAt: timestamp('used_at', { withTimezone: true }),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
});
