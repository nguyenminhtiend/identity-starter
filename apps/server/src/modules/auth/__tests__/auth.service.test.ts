import { describe, expect, it, vi } from 'vitest';

vi.mock('../login-attempts.service.js', () => ({
  getRecentFailureCount: vi.fn(() => Promise.resolve(0)),
  calculateDelay: vi.fn(() => 0),
  recordAttempt: vi.fn(() => Promise.resolve()),
}));

vi.mock('../../mfa/mfa.service.js', () => ({
  checkMfaEnrolled: vi.fn(() => Promise.resolve(false)),
}));

import { createDomainEvent } from '../../../infra/event-bus.js';
import { AUTH_EVENTS } from '../auth.events.js';

describe('auth.service module', () => {
  it('exports login (loads with login-attempts mocked)', async () => {
    vi.stubEnv('DATABASE_URL', 'postgresql://127.0.0.1:5432/unit_test');
    const { login } = await import('../auth.service.js');
    expect(typeof login).toBe('function');
  });
});

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

  it('has PASSWORD_RESET_REQUESTED event name', () => {
    expect(AUTH_EVENTS.PASSWORD_RESET_REQUESTED).toBe('auth.password_reset.requested');
  });

  it('has PASSWORD_RESET_COMPLETED event name', () => {
    expect(AUTH_EVENTS.PASSWORD_RESET_COMPLETED).toBe('auth.password_reset.completed');
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
