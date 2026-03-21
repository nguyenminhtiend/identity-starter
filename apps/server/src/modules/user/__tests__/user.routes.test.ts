import type { Database } from '@identity-starter/db'
import Fastify from 'fastify'
import { serializerCompiler, validatorCompiler } from 'fastify-type-provider-zod'
import mitt from 'mitt'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import type { AllEvents } from '../../../app.js'
import type { UserRepository } from '../user.repository.js'
import { registerUserRoutes } from '../user.routes.js'
import { UserService } from '../user.service.js'

// In-memory fake repository for route testing
const store = new Map<string, Record<string, unknown>>()

function resetStore() {
	store.clear()
}

// Build a test app with in-memory store
async function buildTestApp() {
	resetStore()

	const app = Fastify({ logger: false })
	app.setValidatorCompiler(validatorCompiler)
	app.setSerializerCompiler(serializerCompiler)

	const eventBus = mitt<AllEvents>()
	app.decorate('db', {} as Database)
	app.decorate('eventBus', eventBus)

	// Create a fake repository that uses the in-memory store
	const fakeRepo = {
		create: async (id: string, input: Record<string, unknown>) => {
			const user = {
				id,
				email: input.email,
				emailVerified: false,
				passwordHash: input.passwordHash ?? null,
				displayName: input.displayName,
				status: 'pending_verification',
				metadata: input.metadata ?? {},
				createdAt: new Date(),
				updatedAt: new Date(),
			}
			store.set(id, user)
			return user
		},
		findById: async (id: string) => store.get(id) ?? null,
		findByEmail: async (email: string) => {
			for (const user of store.values()) {
				if (user.email === email) return user
			}
			return null
		},
		update: async (id: string, input: Record<string, unknown>) => {
			const user = store.get(id)
			if (!user) return null
			Object.assign(user, input, { updatedAt: new Date() })
			return user
		},
		delete: async (id: string) => {
			return store.delete(id)
		},
		list: async (page: number, pageSize: number) => {
			const all = Array.from(store.values())
			const offset = (page - 1) * pageSize
			return {
				data: all.slice(offset, offset + pageSize),
				total: all.length,
			}
		},
	} as unknown as UserRepository

	const service = new UserService(fakeRepo, eventBus)
	await app.register(
		async (instance) => {
			registerUserRoutes(instance, service)
		},
		{ prefix: '/api' },
	)

	return app
}

describe('User Routes', () => {
	let app: Awaited<ReturnType<typeof buildTestApp>>

	beforeAll(async () => {
		app = await buildTestApp()
		await app.ready()
	})

	afterAll(async () => {
		await app.close()
	})

	it('POST /api/users — creates a user', async () => {
		const res = await app.inject({
			method: 'POST',
			url: '/api/users',
			payload: {
				email: 'alice@example.com',
				displayName: 'Alice',
			},
		})

		expect(res.statusCode).toBe(201)
		const body = res.json()
		expect(body.email).toBe('alice@example.com')
		expect(body.displayName).toBe('Alice')
		expect(body.passwordHash).toBeUndefined()
	})

	it('POST /api/users — 409 on duplicate email', async () => {
		const res = await app.inject({
			method: 'POST',
			url: '/api/users',
			payload: {
				email: 'alice@example.com',
				displayName: 'Alice 2',
			},
		})

		expect(res.statusCode).toBe(409)
	})

	it('GET /api/users/:id — returns a user', async () => {
		const userId = Array.from(store.keys())[0]
		const res = await app.inject({
			method: 'GET',
			url: `/api/users/${userId}`,
		})

		expect(res.statusCode).toBe(200)
		expect(res.json().email).toBe('alice@example.com')
	})

	it('GET /api/users/:id — 404 for missing user', async () => {
		const res = await app.inject({
			method: 'GET',
			url: '/api/users/nonexistent',
		})

		expect(res.statusCode).toBe(404)
	})

	it('GET /api/users — lists users with pagination', async () => {
		const res = await app.inject({
			method: 'GET',
			url: '/api/users?page=1&pageSize=10',
		})

		expect(res.statusCode).toBe(200)
		const body = res.json()
		expect(body.data).toHaveLength(1)
		expect(body.total).toBe(1)
	})

	it('PATCH /api/users/:id — updates a user', async () => {
		const userId = Array.from(store.keys())[0]
		const res = await app.inject({
			method: 'PATCH',
			url: `/api/users/${userId}`,
			payload: {
				displayName: 'Alice Updated',
			},
		})

		expect(res.statusCode).toBe(200)
		expect(res.json().displayName).toBe('Alice Updated')
	})

	it('POST /api/users/:id/suspend — suspends a user', async () => {
		const userId = Array.from(store.keys())[0]
		const res = await app.inject({
			method: 'POST',
			url: `/api/users/${userId}/suspend`,
		})

		expect(res.statusCode).toBe(200)
	})

	it('POST /api/users/:id/activate — activates a user', async () => {
		const userId = Array.from(store.keys())[0]
		const res = await app.inject({
			method: 'POST',
			url: `/api/users/${userId}/activate`,
		})

		expect(res.statusCode).toBe(200)
	})

	it('DELETE /api/users/:id — deletes a user', async () => {
		const userId = Array.from(store.keys())[0]
		const res = await app.inject({
			method: 'DELETE',
			url: `/api/users/${userId}`,
		})

		expect(res.statusCode).toBe(204)
	})

	it('DELETE /api/users/:id — 404 for already deleted', async () => {
		const res = await app.inject({
			method: 'DELETE',
			url: '/api/users/nonexistent',
		})

		expect(res.statusCode).toBe(404)
	})
})
