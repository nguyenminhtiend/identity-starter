import type { Database } from '@identity-starter/db';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { createDomainEvent, InMemoryEventBus } from '../../../infra/event-bus.js';

const mocks = vi.hoisted(() => ({
  createAuditLog: vi.fn().mockResolvedValue({}),
}));

vi.mock('../audit.service.js', () => ({
  createAuditLog: mocks.createAuditLog,
}));

import { registerAuditListener } from '../audit.listener.js';

describe('audit listener', () => {
  let eventBus: InMemoryEventBus;
  const db = {} as unknown as Database;

  beforeEach(() => {
    eventBus = new InMemoryEventBus();
    mocks.createAuditLog.mockClear();
    registerAuditListener(db, eventBus);
  });

  it('logs auth.registered events', async () => {
    const userId = '550e8400-e29b-41d4-a716-446655440000';
    await eventBus.publish(createDomainEvent('auth.registered', { userId }));

    expect(mocks.createAuditLog).toHaveBeenCalledWith(db, {
      actorId: userId,
      action: 'auth.registered',
      resourceType: 'user',
      resourceId: userId,
      details: { userId },
    });
  });

  it('logs auth.login events', async () => {
    const userId = '550e8400-e29b-41d4-a716-446655440001';
    await eventBus.publish(createDomainEvent('auth.login', { userId }));

    expect(mocks.createAuditLog).toHaveBeenCalledWith(db, {
      actorId: userId,
      action: 'auth.login',
      resourceType: 'session',
      resourceId: userId,
      details: { userId },
    });
  });

  it('logs auth.failed_login events with null actor', async () => {
    await eventBus.publish(
      createDomainEvent('auth.failed_login', { email: 'x@y.com', reason: 'bad password' }),
    );

    expect(mocks.createAuditLog).toHaveBeenCalledWith(db, {
      actorId: null,
      action: 'auth.failed_login',
      resourceType: 'auth',
      resourceId: null,
      details: { email: 'x@y.com', reason: 'bad password' },
    });
  });

  it('logs session.created events', async () => {
    const session = { id: 'sess-1', userId: 'user-1' };
    await eventBus.publish(createDomainEvent('session.created', { session }));

    expect(mocks.createAuditLog).toHaveBeenCalledWith(db, {
      actorId: 'user-1',
      action: 'session.created',
      resourceType: 'session',
      resourceId: 'sess-1',
      details: { session },
    });
  });

  it('logs session.revoked events', async () => {
    await eventBus.publish(
      createDomainEvent('session.revoked', { sessionId: 's-1', userId: 'u-1' }),
    );

    expect(mocks.createAuditLog).toHaveBeenCalledWith(db, {
      actorId: 'u-1',
      action: 'session.revoked',
      resourceType: 'session',
      resourceId: 's-1',
      details: { sessionId: 's-1', userId: 'u-1' },
    });
  });

  it('logs admin.user_suspended events', async () => {
    await eventBus.publish(
      createDomainEvent('admin.user_suspended', { userId: 'u-1', adminId: 'admin-1' }),
    );

    expect(mocks.createAuditLog).toHaveBeenCalledWith(db, {
      actorId: 'admin-1',
      action: 'admin.user_suspended',
      resourceType: 'user',
      resourceId: 'u-1',
      details: { userId: 'u-1', adminId: 'admin-1' },
    });
  });

  it('logs admin.role_created events', async () => {
    await eventBus.publish(createDomainEvent('admin.role_created', { roleId: 'r-1', name: 'mod' }));

    expect(mocks.createAuditLog).toHaveBeenCalledWith(db, {
      actorId: null,
      action: 'admin.role_created',
      resourceType: 'role',
      resourceId: 'r-1',
      details: { roleId: 'r-1', name: 'mod' },
    });
  });

  it('logs account.profile_updated events', async () => {
    await eventBus.publish(createDomainEvent('account.profile_updated', { userId: 'u-1' }));

    expect(mocks.createAuditLog).toHaveBeenCalledWith(db, {
      actorId: 'u-1',
      action: 'account.profile_updated',
      resourceType: 'user',
      resourceId: 'u-1',
      details: { userId: 'u-1' },
    });
  });

  it('logs mfa.totp.enrolled events', async () => {
    await eventBus.publish(createDomainEvent('mfa.totp.enrolled', { userId: 'u-1' }));

    expect(mocks.createAuditLog).toHaveBeenCalledWith(db, {
      actorId: 'u-1',
      action: 'mfa.totp.enrolled',
      resourceType: 'mfa',
      resourceId: 'u-1',
      details: { userId: 'u-1' },
    });
  });

  it('logs passkey.registered events', async () => {
    await eventBus.publish(
      createDomainEvent('passkey.registered', { passkeyId: 'pk-1', userId: 'u-1' }),
    );

    expect(mocks.createAuditLog).toHaveBeenCalledWith(db, {
      actorId: 'u-1',
      action: 'passkey.registered',
      resourceType: 'passkey',
      resourceId: 'pk-1',
      details: { passkeyId: 'pk-1', userId: 'u-1' },
    });
  });

  it('logs oauth.consent_granted events', async () => {
    await eventBus.publish(
      createDomainEvent('oauth.consent_granted', {
        userId: 'u-1',
        clientId: 'c-1',
        scope: 'openid',
      }),
    );

    expect(mocks.createAuditLog).toHaveBeenCalledWith(db, {
      actorId: 'u-1',
      action: 'oauth.consent_granted',
      resourceType: 'consent',
      resourceId: 'c-1',
      details: { userId: 'u-1', clientId: 'c-1', scope: 'openid' },
    });
  });

  it('logs client.created events', async () => {
    await eventBus.publish(createDomainEvent('client.created', { id: 'c-1', clientId: 'my-app' }));

    expect(mocks.createAuditLog).toHaveBeenCalledWith(db, {
      actorId: null,
      action: 'client.created',
      resourceType: 'client',
      resourceId: 'c-1',
      details: { id: 'c-1', clientId: 'my-app' },
    });
  });

  it('does not log unregistered events', async () => {
    await eventBus.publish(createDomainEvent('unknown.event', { foo: 'bar' }));

    expect(mocks.createAuditLog).not.toHaveBeenCalled();
  });
});
