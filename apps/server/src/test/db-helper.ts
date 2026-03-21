/**
 * Per-file database isolation for integration tests.
 *
 * Each test file gets its own PostgreSQL database created from a pre-migrated
 * template (set up by globalSetup). `CREATE DATABASE ... TEMPLATE ...` is a
 * near-instant filesystem-level copy in PG, so this is much faster than
 * running migrations per file.
 */
import crypto from 'node:crypto';
import type { Database } from '@identity-starter/db';
import * as schema from '@identity-starter/db';
import { drizzle } from 'drizzle-orm/postgres-js';
import postgres from 'postgres';

export interface TestDb {
  db: Database;
  connectionString: string;
  teardown: () => Promise<void>;
}

function replaceDbName(databaseUrl: string, dbName: string): string {
  const url = new URL(databaseUrl);
  url.pathname = `/${dbName}`;
  return url.toString();
}

export async function createTestDb(): Promise<TestDb> {
  const url = process.env.DATABASE_URL;
  if (!url) {
    throw new Error('DATABASE_URL is required for integration tests');
  }

  const templateName = process.env.TEST_TEMPLATE_DB;
  if (!templateName) {
    throw new Error('TEST_TEMPLATE_DB is not set — global setup may have failed');
  }

  const dbName = `test_${crypto.randomBytes(6).toString('hex')}`;
  console.log(`[test-db] creating database "${dbName}" from template "${templateName}"...`);

  const adminClient = postgres(url, { max: 1 });
  try {
    await adminClient.unsafe(`CREATE DATABASE "${dbName}" TEMPLATE "${templateName}"`);
    console.log(`[test-db] database "${dbName}" created`);
  } finally {
    await adminClient.end();
  }

  const connectionString = replaceDbName(url, dbName);
  const client = postgres(connectionString, { max: 5 });
  const db = drizzle(client, { schema });

  console.log(`[test-db] connected to "${dbName}"`);

  const teardown = async () => {
    console.log(`[test-db] tearing down "${dbName}"...`);
    await client.end();
    const cleanupClient = postgres(url, { max: 1 });
    try {
      await cleanupClient.unsafe(`DROP DATABASE IF EXISTS "${dbName}" WITH (FORCE)`);
      console.log(`[test-db] dropped "${dbName}"`);
    } finally {
      await cleanupClient.end();
    }
  };

  return { db, connectionString, teardown };
}
