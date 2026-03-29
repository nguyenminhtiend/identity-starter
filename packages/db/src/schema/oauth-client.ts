import { getTableColumns, sql } from 'drizzle-orm';
import { boolean, pgTable, text, timestamp, uuid, varchar } from 'drizzle-orm/pg-core';

export const oauthClients = pgTable('oauth_clients', {
  id: uuid('id').primaryKey().default(sql`uuidv7()`),
  clientId: text('client_id').notNull().unique(),
  clientSecretHash: text('client_secret_hash').notNull(),
  clientName: varchar('client_name', { length: 255 }).notNull(),
  description: text('description'),
  redirectUris: text('redirect_uris').array().notNull(),
  grantTypes: text('grant_types').array().notNull(),
  responseTypes: text('response_types').array().notNull(),
  scope: text('scope').notNull(),
  tokenEndpointAuthMethod: text('token_endpoint_auth_method').notNull(),
  isConfidential: boolean('is_confidential').notNull(),
  logoUri: text('logo_uri'),
  tosUri: text('tos_uri'),
  policyUri: text('policy_uri'),
  isFirstParty: boolean('is_first_party').notNull().default(false),
  applicationType: text('application_type', { enum: ['web', 'native'] })
    .notNull()
    .default('web'),
  status: text('status', { enum: ['active', 'suspended'] })
    .notNull()
    .default('active'),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp('updated_at', { withTimezone: true })
    .notNull()
    .defaultNow()
    .$onUpdate(() => new Date()),
});

const { clientSecretHash: _, ...oauthClientColumns } = getTableColumns(oauthClients);

export { oauthClientColumns };
