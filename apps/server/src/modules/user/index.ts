import type { FastifyInstance } from 'fastify'
import { UserRepository } from './user.repository.js'
import { registerUserRoutes } from './user.routes.js'
import { UserService } from './user.service.js'

export type { User, CreateUserInput, UpdateUserInput } from './user.types.js'
export type { UserEvents } from './user.events.js'
export { UserService } from './user.service.js'

export async function userModule(app: FastifyInstance) {
	const repo = new UserRepository(app.db)
	const service = new UserService(repo, app.eventBus)

	registerUserRoutes(app, service)
}
