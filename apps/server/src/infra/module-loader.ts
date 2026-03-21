import type { FastifyInstance } from 'fastify'
import { userModule } from '../modules/user/index.js'

export async function registerModules(app: FastifyInstance) {
	await app.register(userModule, { prefix: '/api' })
}
