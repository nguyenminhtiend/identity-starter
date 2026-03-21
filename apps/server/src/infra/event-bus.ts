import mitt from 'mitt';
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

export class InMemoryEventBus implements EventBus {
  private emitter = mitt<Record<string, DomainEvent>>();

  async publish(event: DomainEvent): Promise<void> {
    try {
      this.emitter.emit(event.eventName, event);
    } catch (_err) {
      // Prevent subscriber errors from crashing the publisher.
      // In production, replace with structured logging.
    }
  }

  subscribe(eventName: string, handler: EventHandler): void {
    this.emitter.on(eventName, handler);
  }

  unsubscribe(eventName: string, handler: EventHandler): void {
    this.emitter.off(eventName, handler);
  }
}
