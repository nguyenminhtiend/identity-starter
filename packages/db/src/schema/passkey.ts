import { getTableColumns, sql } from 'drizzle-orm';
import { boolean, customType, integer, pgTable, text, timestamp, uuid } from 'drizzle-orm/pg-core';
import { users } from './user.js';

const bytea = customType<{ data: Uint8Array; driverParam: Buffer }>({
  dataType() {
    return 'bytea';
  },
  toDriver(value: Uint8Array): Buffer {
    return Buffer.from(value);
  },
  fromDriver(value: unknown): Uint8Array {
    return new Uint8Array(value as Buffer);
  },
});

export const passkeys = pgTable('passkeys', {
  id: uuid('id').primaryKey().default(sql`uuidv7()`),
  userId: uuid('user_id')
    .notNull()
    .references(() => users.id, { onDelete: 'cascade' }),
  credentialId: text('credential_id').notNull().unique(),
  publicKey: bytea('public_key').notNull(),
  counter: integer('counter').notNull().default(0),
  deviceType: text('device_type').notNull(),
  backedUp: boolean('backed_up').notNull().default(false),
  transports: text('transports').array(),
  name: text('name'),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
});

const { publicKey: _, ...passkeyColumns } = getTableColumns(passkeys);

export { passkeyColumns };
