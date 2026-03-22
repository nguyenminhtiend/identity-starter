import { describe, expect, it } from 'vitest';
import { createDomainEvent } from '../../../infra/event-bus.js';
import { PASSKEY_EVENTS } from '../passkey.events.js';

describe('PASSKEY_EVENTS', () => {
  it('has REGISTERED event name', () => {
    expect(PASSKEY_EVENTS.REGISTERED).toBe('passkey.registered');
  });

  it('has DELETED event name', () => {
    expect(PASSKEY_EVENTS.DELETED).toBe('passkey.deleted');
  });
});

describe('createDomainEvent for passkey', () => {
  it('creates event with correct structure', () => {
    const payload = { passkeyId: 'pk-1', userId: 'user-1' };
    const event = createDomainEvent(PASSKEY_EVENTS.REGISTERED, payload);

    expect(event.id).toBeDefined();
    expect(event.eventName).toBe('passkey.registered');
    expect(event.occurredOn).toBeInstanceOf(Date);
    expect(event.payload).toBe(payload);
  });

  it('generates unique event ids', () => {
    const event1 = createDomainEvent(PASSKEY_EVENTS.REGISTERED, {});
    const event2 = createDomainEvent(PASSKEY_EVENTS.REGISTERED, {});
    expect(event1.id).not.toBe(event2.id);
  });
});
