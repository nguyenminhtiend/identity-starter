import Emittery from 'emittery';
import { v7 as uuidv7 } from 'uuid';

export interface DomainEvent<T = unknown> {
  readonly id: string;
  readonly eventName: string;
  readonly occurredOn: Date;
  readonly payload: T;
}

export type EventHandler = (event: DomainEvent) => Promise<void> | void;

export interface EventBus {
  publish(event: DomainEvent): Promise<void>;
  subscribe(eventName: string, handler: EventHandler): void;
  unsubscribe(eventName: string, handler: EventHandler): void;
}

export function createDomainEvent<T>(eventName: string, payload: T): DomainEvent<T> {
  return { id: uuidv7(), eventName, occurredOn: new Date(), payload };
}

interface EmitteryEvent {
  name: string;
  data: DomainEvent;
}

export class InMemoryEventBus implements EventBus {
  private emitter = new Emittery();
  private wrapperMap = new Map<EventHandler, (wrapped: unknown) => Promise<void> | void>();

  async publish(event: DomainEvent): Promise<void> {
    await this.emitter.emit(event.eventName, event);
  }

  subscribe(eventName: string, handler: EventHandler): void {
    const wrapper = (wrapped: unknown) => {
      const { data } = wrapped as EmitteryEvent;
      return handler(data);
    };
    this.wrapperMap.set(handler, wrapper);
    this.emitter.on(eventName, wrapper);
  }

  unsubscribe(eventName: string, handler: EventHandler): void {
    const wrapper = this.wrapperMap.get(handler);
    if (wrapper) {
      this.emitter.off(eventName, wrapper);
      this.wrapperMap.delete(handler);
    }
  }
}
