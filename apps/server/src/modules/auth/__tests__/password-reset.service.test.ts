import { UnauthorizedError } from '@identity-starter/core';
import { describe, expect, it, vi } from 'vitest';
import { InMemoryEventBus } from '../../../infra/event-bus.js';
import { createMockDb } from '../../../test/mock-db.js';
import { AUTH_EVENTS } from '../auth.events.js';
import { requestPasswordReset, resetPassword } from '../password-reset.service.js';

const mockHashPassword = vi.fn();
const mockRevokeAllUserSessions = vi.fn();

vi.mock('../../../core/password.js', () => ({
  hashPassword: (...args: unknown[]) => mockHashPassword(...args),
}));

vi.mock('../../session/session.service.js', () => ({
  revokeAllUserSessions: (...args: unknown[]) => mockRevokeAllUserSessions(...args),
}));

describe('requestPasswordReset', () => {
  it('returns null when user is not found', async () => {
    const db = createMockDb({
      select: vi.fn().mockReturnValue({
        from: vi.fn().mockReturnThis(),
        where: vi.fn().mockReturnThis(),
        limit: vi.fn().mockResolvedValue([]),
      }),
      insert: vi.fn(),
    });

    const eventBus = new InMemoryEventBus();
    const publishSpy = vi.spyOn(eventBus, 'publish');

    const result = await requestPasswordReset(db, eventBus, 'missing@example.com');

    expect(result).toBeNull();
    expect(db.insert).not.toHaveBeenCalled();
    expect(publishSpy).not.toHaveBeenCalled();
  });

  it('returns null when hourly unused token limit is reached', async () => {
    const userRow = {
      id: '550e8400-e29b-41d4-a716-446655440000',
      email: 'u@example.com',
    };

    const db = createMockDb({
      select: vi.fn(),
      insert: vi.fn(),
    });

    vi.mocked(db.select)
      .mockReturnValueOnce({
        from: vi.fn().mockReturnThis(),
        where: vi.fn().mockReturnThis(),
        limit: vi.fn().mockResolvedValue([userRow]),
      } as never)
      .mockReturnValueOnce({
        from: vi.fn().mockReturnValue({
          where: vi.fn().mockResolvedValue([{ count: 3 }]),
        }),
      } as never);

    const eventBus = new InMemoryEventBus();
    const publishSpy = vi.spyOn(eventBus, 'publish');

    const result = await requestPasswordReset(db, eventBus, userRow.email);

    expect(result).toBeNull();
    expect(db.insert).not.toHaveBeenCalled();
    expect(publishSpy).not.toHaveBeenCalled();
  });

  it('creates token, publishes event, and returns token when allowed', async () => {
    const userRow = {
      id: '550e8400-e29b-41d4-a716-446655440000',
      email: 'u@example.com',
    };

    const values = vi.fn().mockResolvedValue(undefined);
    const db = createMockDb({
      select: vi.fn(),
      insert: vi.fn().mockReturnValue({ values }),
    });

    vi.mocked(db.select)
      .mockReturnValueOnce({
        from: vi.fn().mockReturnThis(),
        where: vi.fn().mockReturnThis(),
        limit: vi.fn().mockResolvedValue([userRow]),
      } as never)
      .mockReturnValueOnce({
        from: vi.fn().mockReturnValue({
          where: vi.fn().mockResolvedValue([{ count: 0 }]),
        }),
      } as never);

    const eventBus = new InMemoryEventBus();
    const events: { eventName: string; payload: unknown }[] = [];
    eventBus.subscribe(AUTH_EVENTS.PASSWORD_RESET_REQUESTED, (e) => {
      events.push({ eventName: e.eventName, payload: e.payload });
    });

    const token = await requestPasswordReset(db, eventBus, userRow.email);

    expect(token).toBeTruthy();
    expect(typeof token).toBe('string');
    expect(values).toHaveBeenCalledWith(
      expect.objectContaining({
        userId: userRow.id,
        token,
        expiresAt: expect.any(Date),
      }),
    );
    expect(events).toHaveLength(1);
    expect(events[0].payload).toEqual({
      userId: userRow.id,
      email: userRow.email,
      token,
    });
  });
});

describe('resetPassword', () => {
  it('throws UnauthorizedError when token is invalid', async () => {
    mockHashPassword.mockReset();
    mockRevokeAllUserSessions.mockReset();

    const db = createMockDb({
      select: vi.fn().mockReturnValue({
        from: vi.fn().mockReturnThis(),
        where: vi.fn().mockReturnThis(),
        limit: vi.fn().mockResolvedValue([]),
      }),
      update: vi.fn(),
    });

    const eventBus = new InMemoryEventBus();

    await expect(
      resetPassword(db, eventBus, { token: 'bad', newPassword: 'newpassword1' }),
    ).rejects.toThrow(UnauthorizedError);

    expect(mockHashPassword).not.toHaveBeenCalled();
    expect(mockRevokeAllUserSessions).not.toHaveBeenCalled();
    expect(db.update).not.toHaveBeenCalled();
  });

  it('updates password, revokes sessions, marks token used, and publishes event', async () => {
    mockHashPassword.mockReset();
    mockRevokeAllUserSessions.mockReset();
    mockHashPassword.mockResolvedValue('$argon2id$mockhash');

    const tokenRow = {
      id: '660e8400-e29b-41d4-a716-446655440000',
      userId: '550e8400-e29b-41d4-a716-446655440000',
      token: 'raw-token',
      expiresAt: new Date(Date.now() + 60_000),
      usedAt: null,
      createdAt: new Date(),
    };

    const userUpdateWhere = vi.fn().mockResolvedValue(undefined);
    const tokenUpdateWhere = vi.fn().mockResolvedValue(undefined);

    const txUpdate = vi
      .fn()
      .mockReturnValueOnce({
        set: vi.fn().mockReturnThis(),
        where: userUpdateWhere,
      })
      .mockReturnValueOnce({
        set: vi.fn().mockReturnThis(),
        where: tokenUpdateWhere,
      });

    const db = createMockDb({
      select: vi.fn().mockReturnValue({
        from: vi.fn().mockReturnThis(),
        where: vi.fn().mockReturnThis(),
        limit: vi.fn().mockResolvedValue([tokenRow]),
      }),
      transaction: vi.fn(async (fn: (tx: { update: typeof txUpdate }) => Promise<void>) => {
        await fn({ update: txUpdate });
      }),
    });

    const eventBus = new InMemoryEventBus();
    const completed: unknown[] = [];
    eventBus.subscribe(AUTH_EVENTS.PASSWORD_RESET_COMPLETED, (e) => {
      completed.push(e.payload);
    });

    await resetPassword(db, eventBus, { token: 'raw-token', newPassword: 'newpassword1' });

    expect(mockHashPassword).toHaveBeenCalledWith('newpassword1');
    expect(mockRevokeAllUserSessions).toHaveBeenCalledWith(db, eventBus, tokenRow.userId);
    expect(completed).toEqual([{ userId: tokenRow.userId }]);
    expect(db.transaction).toHaveBeenCalledTimes(1);
    expect(txUpdate).toHaveBeenCalledTimes(2);
  });
});
