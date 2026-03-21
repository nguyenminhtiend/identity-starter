import { drizzle } from 'drizzle-orm/postgres-js'
import postgres from 'postgres'
import * as schema from './schema/index.js'

export function createDb(url: string) {
	const client = postgres(url)
	const db = drizzle(client, { schema })
	return { db, client }
}

export type Database = ReturnType<typeof createDb>['db']
