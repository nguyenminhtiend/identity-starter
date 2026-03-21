import mitt, { type Emitter } from 'mitt'

export type { Emitter }

export function createEventBus<T extends Record<string, unknown>>(): Emitter<T> {
	return mitt<T>()
}
