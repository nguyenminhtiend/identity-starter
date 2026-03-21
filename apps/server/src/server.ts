import { createDb } from '@identity-starter/db'
import { createEnv } from '@t3-oss/env-core'
import { z } from 'zod'
import { buildApp } from './app.js'

const env = createEnv({
	server: {
		DATABASE_URL: z.string().url(),
		REDIS_URL: z.string().url(),
		PORT: z.coerce.number().default(3000),
		HOST: z.string().default('0.0.0.0'),
		NODE_ENV: z.enum(['development', 'production', 'test']).default('development'),
		LOG_LEVEL: z.enum(['fatal', 'error', 'warn', 'info', 'debug', 'trace']).default('info'),
	},
	runtimeEnv: process.env,
})

const { db } = createDb(env.DATABASE_URL)

const app = await buildApp({
	db,
	logger: {
		level: env.LOG_LEVEL,
		transport:
			env.NODE_ENV === 'development'
				? { target: 'pino-pretty', options: { colorize: true } }
				: undefined,
	},
})

try {
	await app.listen({ port: env.PORT, host: env.HOST })
} catch (err) {
	app.log.error(err)
	process.exit(1)
}
