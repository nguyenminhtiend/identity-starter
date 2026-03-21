import { describe, expect, it } from 'vitest';
import { createDomainEvent } from '../../../infra/event-bus.js';
import { AUTH_EVENTS } from '../auth.events.js';

describe('AUTH_EVENTS', () => {
  it('has REGISTERED event name', () => {
    expect(AUTH_EVENTS.REGISTERED).toBe('auth.registered');
  });

  it('has LOGIN event name', () => {
    expect(AUTH_EVENTS.LOGIN).toBe('auth.login');
  });

  it('has LOGOUT event name', () => {
    expect(AUTH_EVENTS.LOGOUT).toBe('auth.logout');
  });

  it('has PASSWORD_CHANGED event name', () => {
    expect(AUTH_EVENTS.PASSWORD_CHANGED).toBe('auth.password_changed');
  });

  it('has FAILED_LOGIN event name', () => {
    expect(AUTH_EVENTS.FAILED_LOGIN).toBe('auth.failed_login');
  });
});

describe('createDomainEvent for auth', () => {
  it('creates registered event with correct structure', () => {
    const payload = { userId: 'user-123' };
    const event = createDomainEvent(AUTH_EVENTS.REGISTERED, payload);

    expect(event.id).toBeDefined();
    expect(event.eventName).toBe('auth.registered');
    expect(event.occurredOn).toBeInstanceOf(Date);
    expect(event.payload).toBe(payload);
  });

  it('creates failed_login event with correct structure', () => {
    const payload = { email: 'test@example.com', reason: 'invalid_credentials' };
    const event = createDomainEvent(AUTH_EVENTS.FAILED_LOGIN, payload);

    expect(event.eventName).toBe('auth.failed_login');
    expect(event.payload).toBe(payload);
  });

  it('generates unique event ids', () => {
    const event1 = createDomainEvent(AUTH_EVENTS.LOGIN, { userId: '1' });
    const event2 = createDomainEvent(AUTH_EVENTS.LOGIN, { userId: '2' });
    expect(event1.id).not.toBe(event2.id);
  });
});
