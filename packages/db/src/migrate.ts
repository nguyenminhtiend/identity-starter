import { drizzle } from 'drizzle-orm/postgres-js';
import { migrate } from 'drizzle-orm/postgres-js/migrator';
import postgres from 'postgres';

const url = process.env.DATABASE_URL;
if (!url) {
  // biome-ignore lint/suspicious/noConsole: CLI migration script
  console.error('DATABASE_URL is required');
  process.exit(1);
}

// biome-ignore lint/suspicious/noConsole: CLI migration script
const log = console.log;

const client = postgres(url, { max: 1, onnotice: () => {} });
const db = drizzle(client);

log('Running migrations…');
const start = performance.now();

await migrate(db, {
  migrationsFolder: './drizzle',
  migrationsTable: '__migrations',
  migrationsSchema: 'public',
});

const elapsed = (performance.now() - start).toFixed(0);
log(`Migrations complete (${elapsed}ms)`);
await client.end();
