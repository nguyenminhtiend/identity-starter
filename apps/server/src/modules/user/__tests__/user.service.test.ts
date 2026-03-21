import { describe, expect, it } from 'vitest';
import { createDomainEvent } from '../../../infra/event-bus.js';
import { makeUser } from '../../../test/factory.js';
import { USER_EVENTS } from '../user.events.js';

describe('USER_EVENTS', () => {
  it('has CREATED event name', () => {
    expect(USER_EVENTS.CREATED).toBe('user.created');
  });
});

describe('createDomainEvent', () => {
  it('creates event with correct structure', () => {
    const payload = { user: makeUser() };
    const event = createDomainEvent(USER_EVENTS.CREATED, payload);

    expect(event.id).toBeDefined();
    expect(event.eventName).toBe('user.created');
    expect(event.occurredOn).toBeInstanceOf(Date);
    expect(event.payload).toBe(payload);
  });

  it('generates unique event ids', () => {
    const event1 = createDomainEvent('test', {});
    const event2 = createDomainEvent('test', {});
    expect(event1.id).not.toBe(event2.id);
  });
});
