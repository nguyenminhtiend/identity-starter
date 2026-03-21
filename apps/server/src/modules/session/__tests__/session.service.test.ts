import { describe, expect, it } from 'vitest';
import { createDomainEvent } from '../../../infra/event-bus.js';
import { SESSION_EVENTS } from '../session.events.js';
import { makeSession } from './session.factory.js';

describe('SESSION_EVENTS', () => {
  it('has CREATED event name', () => {
    expect(SESSION_EVENTS.CREATED).toBe('session.created');
  });

  it('has REVOKED event name', () => {
    expect(SESSION_EVENTS.REVOKED).toBe('session.revoked');
  });
});

describe('createDomainEvent', () => {
  it('creates event with correct structure for session created', () => {
    const payload = { session: makeSession() };
    const event = createDomainEvent(SESSION_EVENTS.CREATED, payload);
    expect(event.id).toBeDefined();
    expect(event.eventName).toBe('session.created');
    expect(event.occurredOn).toBeInstanceOf(Date);
    expect(event.payload).toBe(payload);
  });

  it('creates event with correct structure for session revoked', () => {
    const payload = { sessionId: 'test-id', userId: 'test-user' };
    const event = createDomainEvent(SESSION_EVENTS.REVOKED, payload);
    expect(event.eventName).toBe('session.revoked');
    expect(event.payload).toBe(payload);
  });
});
