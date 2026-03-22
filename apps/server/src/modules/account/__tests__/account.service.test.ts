import { NotFoundError, ValidationError } from '@identity-starter/core';
import type { Database } from '@identity-starter/db';
import { describe, expect, it, vi } from 'vitest';
import { createDomainEvent, InMemoryEventBus } from '../../../infra/event-bus.js';
import { ACCOUNT_EVENTS } from '../account.events.js';
import { getProfile, revokeOwnSession } from '../account.service.js';

describe('ACCOUNT_EVENTS', () => {
  it('has stable event names', () => {
    expect(ACCOUNT_EVENTS.PROFILE_UPDATED).toBe('account.profile_updated');
    expect(ACCOUNT_EVENTS.SESSION_REVOKED).toBe('account.session_revoked');
    expect(ACCOUNT_EVENTS.PASSKEY_RENAMED).toBe('account.passkey_renamed');
    expect(ACCOUNT_EVENTS.PASSKEY_DELETED).toBe('account.passkey_deleted');
  });
});

describe('createDomainEvent for account', () => {
  it('builds profile_updated payload', () => {
    const event = createDomainEvent(ACCOUNT_EVENTS.PROFILE_UPDATED, { userId: 'u1' });
    expect(event.eventName).toBe(ACCOUNT_EVENTS.PROFILE_UPDATED);
    expect(event.payload).toEqual({ userId: 'u1' });
  });
});

describe('revokeOwnSession', () => {
  it('rejects revoking the active session before querying the database', async () => {
    const db = {} as Database;
    const bus = new InMemoryEventBus();
    await expect(revokeOwnSession(db, bus, 'user-1', 'sess-a', 'sess-a')).rejects.toThrow(
      ValidationError,
    );
  });
});

describe('getProfile (mocked db)', () => {
  it('throws NotFoundError when select returns empty', async () => {
    const limit = vi.fn().mockResolvedValue([]);
    const where = vi.fn().mockReturnValue({ limit });
    const from = vi.fn().mockReturnValue({ where });
    const db = {
      select: vi.fn().mockReturnValue({ from }),
    } as unknown as Database;

    await expect(getProfile(db, '00000000-0000-0000-0000-000000000000')).rejects.toThrow(
      NotFoundError,
    );
  });

  it('maps row to profile response', async () => {
    const row = {
      id: '550e8400-e29b-41d4-a716-446655440000',
      email: 'a@example.com',
      emailVerified: true,
      displayName: 'Alice',
      status: 'active',
      metadata: { k: 1 },
      createdAt: new Date('2020-01-01'),
    };
    const limit = vi.fn().mockResolvedValue([row]);
    const where = vi.fn().mockReturnValue({ limit });
    const from = vi.fn().mockReturnValue({ where });
    const db = {
      select: vi.fn().mockReturnValue({ from }),
    } as unknown as Database;

    const profile = await getProfile(db, row.id);
    expect(profile.email).toBe('a@example.com');
    expect(profile.status).toBe('active');
    expect(profile.metadata).toEqual({ k: 1 });
  });
});
