import { drizzle } from 'drizzle-orm/postgres-js';
import { migrate } from 'drizzle-orm/postgres-js/migrator';
import postgres from 'postgres';

const url = process.env.DATABASE_URL;
if (!url) {
  // biome-ignore lint/suspicious/noConsole: CLI migration script, no app logger
  console.error('DATABASE_URL is required');
  process.exit(1);
}

const client = postgres(url, { max: 1 });
const db = drizzle(client);

await migrate(db, { migrationsFolder: './drizzle' });
// biome-ignore lint/suspicious/noConsole: CLI migration script, no app logger
console.log('Migrations complete');
await client.end();
