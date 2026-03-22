import { UnauthorizedError } from '@identity-starter/core';
import type { Database } from '@identity-starter/db';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { InMemoryEventBus } from '../../../infra/event-bus.js';
import { AUTH_EVENTS } from '../auth.events.js';
import { verifyEmail } from '../email-verification.service.js';

describe('verifyEmail (unit)', () => {
  let eventBus: InMemoryEventBus;

  beforeEach(() => {
    eventBus = new InMemoryEventBus();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('throws UnauthorizedError when token row is missing', async () => {
    const limit = vi.fn().mockResolvedValue([]);
    const where = vi.fn().mockReturnValue({ limit });
    const from = vi.fn().mockReturnValue({ where });
    const select = vi.fn().mockReturnValue({ from });

    const db = { select } as unknown as Database;

    await expect(verifyEmail(db, eventBus, 'missing')).rejects.toThrow(UnauthorizedError);
  });

  it('throws UnauthorizedError when token is already used', async () => {
    const limit = vi.fn().mockResolvedValue([
      {
        id: 'tok-id',
        userId: 'user-id',
        token: 't',
        expiresAt: new Date(Date.now() + 60_000),
        usedAt: new Date(),
      },
    ]);
    const where = vi.fn().mockReturnValue({ limit });
    const from = vi.fn().mockReturnValue({ where });
    const select = vi.fn().mockReturnValue({ from });

    const db = { select } as unknown as Database;

    await expect(verifyEmail(db, eventBus, 't')).rejects.toThrow(UnauthorizedError);
  });

  it('throws UnauthorizedError when token is expired', async () => {
    const limit = vi.fn().mockResolvedValue([
      {
        id: 'tok-id',
        userId: 'user-id',
        token: 't',
        expiresAt: new Date(Date.now() - 60_000),
        usedAt: null,
      },
    ]);
    const where = vi.fn().mockReturnValue({ limit });
    const from = vi.fn().mockReturnValue({ where });
    const select = vi.fn().mockReturnValue({ from });

    const db = { select } as unknown as Database;

    await expect(verifyEmail(db, eventBus, 't')).rejects.toThrow(UnauthorizedError);
  });

  it('throws UnauthorizedError when transactional consume fails', async () => {
    const limit = vi.fn().mockResolvedValue([
      {
        id: 'tok-id',
        userId: 'user-id',
        token: 't',
        expiresAt: new Date(Date.now() + 60_000),
        usedAt: null,
      },
    ]);
    const where = vi.fn().mockReturnValue({ limit });
    const from = vi.fn().mockReturnValue({ where });
    const select = vi.fn().mockReturnValue({ from });

    const returning = vi.fn().mockResolvedValue([]);
    const whereU = vi.fn().mockReturnValue({ returning });
    const set = vi.fn().mockReturnValue({ where: whereU });
    const update = vi.fn().mockReturnValue({ set });

    const transaction = vi.fn(async (fn: (tx: unknown) => Promise<void>) => {
      const tx = { update };
      await fn(tx);
    });

    const db = { select, transaction } as unknown as Database;

    await expect(verifyEmail(db, eventBus, 't')).rejects.toThrow(UnauthorizedError);
  });

  it('consumes token and publishes EMAIL_VERIFIED when user is pending_verification', async () => {
    const userId = '550e8400-e29b-41d4-a716-446655440000';
    const tokenRow = {
      id: 'tok-id',
      userId,
      token: 'raw-token',
      expiresAt: new Date(Date.now() + 60_000),
      usedAt: null,
    };

    const limitSel = vi.fn().mockResolvedValue([tokenRow]);
    const whereSel = vi.fn().mockReturnValue({ limit: limitSel });
    const fromSel = vi.fn().mockReturnValue({ where: whereSel });
    const selectOuter = vi.fn().mockReturnValue({ from: fromSel });

    const events: { eventName: string; payload: unknown }[] = [];
    eventBus.subscribe(AUTH_EVENTS.EMAIL_VERIFIED, (e) => {
      events.push({ eventName: e.eventName, payload: e.payload });
    });

    const returningMark = vi.fn().mockResolvedValue([{ id: 'tok-id' }]);
    const whereMark = vi.fn().mockReturnValue({ returning: returningMark });
    const setMark = vi.fn().mockReturnValue({ where: whereMark });
    const updateTok = vi.fn().mockReturnValue({ set: setMark });

    const limitUser = vi.fn().mockResolvedValue([
      {
        id: userId,
        status: 'pending_verification',
        emailVerified: false,
      },
    ]);
    const whereUser = vi.fn().mockReturnValue({ limit: limitUser });
    const fromUser = vi.fn().mockReturnValue({ where: whereUser });

    const whereUserUp = vi.fn().mockReturnValue({});
    const setUser = vi.fn().mockReturnValue({ where: whereUserUp });
    const updateUser = vi.fn().mockReturnValue({ set: setUser });

    const update = vi.fn((_table: unknown) => {
      if (update.mock.calls.length === 1) {
        return updateTok();
      }
      return updateUser();
    });

    const selectTx = vi.fn(() => ({ from: fromUser }));

    const transaction = vi.fn(async (fn: (tx: unknown) => Promise<void>) => {
      const tx = { update, select: selectTx };
      await fn(tx);
    });

    const db = { select: selectOuter, transaction } as unknown as Database;

    await verifyEmail(db, eventBus, 'raw-token');

    expect(events).toHaveLength(1);
    expect(events[0].eventName).toBe(AUTH_EVENTS.EMAIL_VERIFIED);
    expect(events[0].payload).toEqual({ userId });
  });
});
