import crypto from 'node:crypto';
import path from 'node:path';
import process from 'node:process';
import { drizzle } from 'drizzle-orm/postgres-js';
import { migrate } from 'drizzle-orm/postgres-js/migrator';
import postgres from 'postgres';

const projectRoot = path.resolve(import.meta.dirname, '../..');

function loadEnvFile() {
  try {
    process.loadEnvFile(path.join(projectRoot, '.env'));
  } catch {
    // .env file is optional — env vars may come from the environment directly
  }
}

function replaceDbName(databaseUrl: string, dbName: string): string {
  const url = new URL(databaseUrl);
  url.pathname = `/${dbName}`;
  return url.toString();
}

export async function setup() {
  loadEnvFile();

  const url = process.env.DATABASE_URL;
  if (!url) {
    throw new Error(
      'DATABASE_URL environment variable is required for integration tests. ' +
        'Set it in your environment or apps/server/.env file.',
    );
  }

  // Verify connectivity and uuidv7() availability before creating anything
  const checkClient = postgres(url, { max: 1 });
  try {
    await checkClient`SELECT 1`;
    await checkClient`SELECT uuidv7()`;
  } catch (error) {
    throw new Error(`Cannot connect to test database: ${error}`);
  } finally {
    await checkClient.end();
  }

  // Create the template database
  const templateName = `test_template_${crypto.randomBytes(4).toString('hex')}`;
  const adminClient = postgres(url, { max: 1 });
  try {
    await adminClient.unsafe(`CREATE DATABASE "${templateName}"`);
  } finally {
    await adminClient.end();
  }

  // Run drizzle migrations against the template
  const templateUrl = replaceDbName(url, templateName);
  const migrationClient = postgres(templateUrl, { max: 1 });
  const db = drizzle(migrationClient);
  const migrationsFolder = path.resolve(projectRoot, '../../packages/db/drizzle');

  try {
    await migrate(db, { migrationsFolder });
  } finally {
    await migrationClient.end();
  }

  // Propagated to forked test workers via process.env inheritance
  process.env.TEST_TEMPLATE_DB = templateName;
}

export async function teardown() {
  const url = process.env.DATABASE_URL;
  if (!url) {
    return;
  }

  const client = postgres(url, { max: 1 });
  try {
    const dbs = await client<{ datname: string }[]>`
      SELECT datname FROM pg_database
      WHERE datname LIKE 'test_%'
    `;
    for (const { datname } of dbs) {
      await client.unsafe(`DROP DATABASE IF EXISTS "${datname}" WITH (FORCE)`);
    }
  } finally {
    await client.end();
  }
}
