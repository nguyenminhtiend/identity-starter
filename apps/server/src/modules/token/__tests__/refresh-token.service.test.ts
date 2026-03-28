import { createHash, randomBytes } from 'node:crypto';

import { UnauthorizedError } from '@identity-starter/core';
import type { Database } from '@identity-starter/db';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createDomainEvent, InMemoryEventBus } from '../../../infra/event-bus.js';
import {
  createRefreshToken,
  createRefreshTokenService,
  hashToken,
  revokeAllForClient,
  revokeRefreshToken,
  rotateRefreshToken,
} from '../refresh-token.service.js';
import { TOKEN_EVENTS } from '../token.events.js';
import { buildCreateRefreshTokenParams } from './token.factory.js';

vi.mock('uuid', () => ({
  v7: vi.fn(() => '0195b4a0-6c3b-7f00-8000-000000000001'),
}));

vi.mock('node:crypto', async (importOriginal) => {
  const actual = await importOriginal<typeof import('node:crypto')>();
  return {
    ...actual,
    randomBytes: vi.fn(actual.randomBytes),
  };
});

describe('refresh token service (unit)', () => {
  let eventBus: InMemoryEventBus;

  beforeEach(async () => {
    eventBus = new InMemoryEventBus();
    const realCrypto = await vi.importActual<typeof import('node:crypto')>('node:crypto');
    vi.mocked(randomBytes).mockImplementation(realCrypto.randomBytes);
  });

  afterEach(() => {
    vi.clearAllMocks();
  });

  it('createRefreshToken generates opaque token, stores hash, creates familyId, returns plaintext', async () => {
    const fixed = Buffer.alloc(32, 0xab);
    vi.mocked(randomBytes).mockReturnValueOnce(fixed);

    const values = vi.fn().mockResolvedValue(undefined);
    const insert = vi.fn().mockReturnValue({ values });

    const events: { eventName: string; payload: unknown }[] = [];
    eventBus.subscribe(TOKEN_EVENTS.REFRESH_ISSUED, (e) => {
      events.push({ eventName: e.eventName, payload: e.payload });
    });

    const db = { insert } as unknown as Database;
    const params = buildCreateRefreshTokenParams();

    const plaintext = fixed.toString('base64url');
    const expectedHash = createHash('sha256').update(plaintext).digest('hex');

    const result = await createRefreshToken(db, eventBus, params);

    expect(result.plaintext).toBe(plaintext);
    expect(result.familyId).toBe('0195b4a0-6c3b-7f00-8000-000000000001');
    expect(values).toHaveBeenCalledWith(
      expect.objectContaining({
        token: expectedHash,
        clientId: params.clientId,
        userId: params.userId,
        scope: params.scope,
        familyId: '0195b4a0-6c3b-7f00-8000-000000000001',
      }),
    );
    expect(events).toHaveLength(1);
    expect(events[0]?.eventName).toBe(TOKEN_EVENTS.REFRESH_ISSUED);
  });

  it('createRefreshToken stores dpopJkt in the DB insert when provided', async () => {
    const fixed = Buffer.alloc(32, 0xab);
    vi.mocked(randomBytes).mockReturnValueOnce(fixed);

    const values = vi.fn().mockResolvedValue(undefined);
    const insert = vi.fn().mockReturnValue({ values });

    const db = { insert } as unknown as Database;
    const params = buildCreateRefreshTokenParams({ dpopJkt: 'bound-jkt-value' });

    await createRefreshToken(db, eventBus, params);

    expect(values).toHaveBeenCalledWith(
      expect.objectContaining({
        dpopJkt: 'bound-jkt-value',
      }),
    );
  });

  it('rotateRefreshToken revokes old token, inserts successor, returns new plaintext', async () => {
    const oldPlain = 'client-presented-refresh';
    const oldHash = hashToken(oldPlain);
    const newBuf = Buffer.alloc(32, 0xcd);
    vi.mocked(randomBytes).mockReturnValueOnce(newBuf);

    const now = Date.now();
    const validRow = {
      id: 'row-1',
      token: oldHash,
      clientId: 'c1',
      userId: 'u1',
      scope: 'openid profile',
      expiresAt: new Date(now + 86_400_000),
      revokedAt: null,
      rotationGracePlaintext: null,
      dpopJkt: null,
      familyId: '0195b4a0-6c3b-7f00-8000-000000000002',
      createdAt: new Date(now - 60_000),
    };

    const outerLimit = vi.fn().mockResolvedValue([validRow]);
    const outerWhere = vi.fn().mockReturnValue({ limit: outerLimit });
    const outerFrom = vi.fn().mockReturnValue({ where: outerWhere });
    const outerSelect = vi.fn().mockReturnValue({ from: outerFrom });

    const txLimit = vi.fn().mockResolvedValue([validRow]);
    const txWhereSel = vi.fn().mockReturnValue({ limit: txLimit });
    const txFrom = vi.fn().mockReturnValue({ where: txWhereSel });
    const txSelect = vi.fn().mockReturnValue({ from: txFrom });

    const txInsertValues = vi.fn().mockResolvedValue(undefined);
    const txInsert = vi.fn().mockReturnValue({ values: txInsertValues });

    const txWhereUp = vi.fn().mockResolvedValue(undefined);
    const txSet = vi.fn().mockReturnValue({ where: txWhereUp });
    const txUpdate = vi.fn().mockReturnValue({ set: txSet });

    const transaction = vi.fn(async (fn: (tx: unknown) => Promise<void>) => {
      await fn({
        select: txSelect,
        update: txUpdate,
        insert: txInsert,
      });
    });

    const db = { select: outerSelect, transaction } as unknown as Database;

    const events: string[] = [];
    eventBus.subscribe(TOKEN_EVENTS.REFRESH_REVOKED, () => {
      events.push(TOKEN_EVENTS.REFRESH_REVOKED);
    });
    eventBus.subscribe(TOKEN_EVENTS.REFRESH_ISSUED, () => {
      events.push(TOKEN_EVENTS.REFRESH_ISSUED);
    });

    const newPlain = await rotateRefreshToken(db, eventBus, oldPlain, 10);

    expect(newPlain).toBe(newBuf.toString('base64url'));
    expect(txSet).toHaveBeenCalledWith(
      expect.objectContaining({
        rotationGracePlaintext: hashToken(newPlain),
        revokedAt: expect.any(Date) as Date,
      }),
    );
    expect(txInsertValues).toHaveBeenCalledWith(
      expect.objectContaining({
        token: hashToken(newPlain),
        familyId: validRow.familyId,
        clientId: validRow.clientId,
        userId: validRow.userId,
      }),
    );
    expect(events).toEqual([TOKEN_EVENTS.REFRESH_REVOKED, TOKEN_EVENTS.REFRESH_ISSUED]);
  });

  it('rotateRefreshToken for DPoP-bound token inserts successor with same dpopJkt', async () => {
    const oldPlain = 'dpop-bound-refresh';
    const oldHash = hashToken(oldPlain);
    const boundJkt = 'expected-jkt-thumbprint';
    const newBuf = Buffer.alloc(32, 0xde);
    vi.mocked(randomBytes).mockReturnValueOnce(newBuf);

    const now = Date.now();
    const validRow = {
      id: 'row-dpop',
      token: oldHash,
      clientId: 'c1',
      userId: 'u1',
      scope: 'openid profile',
      expiresAt: new Date(now + 86_400_000),
      revokedAt: null,
      rotationGracePlaintext: null,
      dpopJkt: boundJkt,
      familyId: '0195b4a0-6c3b-7f00-8000-000000000099',
      createdAt: new Date(now - 60_000),
    };

    const outerLimit = vi.fn().mockResolvedValue([validRow]);
    const outerWhere = vi.fn().mockReturnValue({ limit: outerLimit });
    const outerFrom = vi.fn().mockReturnValue({ where: outerWhere });
    const outerSelect = vi.fn().mockReturnValue({ from: outerFrom });

    const txLimit = vi.fn().mockResolvedValue([validRow]);
    const txWhereSel = vi.fn().mockReturnValue({ limit: txLimit });
    const txFrom = vi.fn().mockReturnValue({ where: txWhereSel });
    const txSelect = vi.fn().mockReturnValue({ from: txFrom });

    const txInsertValues = vi.fn().mockResolvedValue(undefined);
    const txInsert = vi.fn().mockReturnValue({ values: txInsertValues });

    const txWhereUp = vi.fn().mockResolvedValue(undefined);
    const txSet = vi.fn().mockReturnValue({ where: txWhereUp });
    const txUpdate = vi.fn().mockReturnValue({ set: txSet });

    const transaction = vi.fn(async (fn: (tx: unknown) => Promise<void>) => {
      await fn({
        select: txSelect,
        update: txUpdate,
        insert: txInsert,
      });
    });

    const db = { select: outerSelect, transaction } as unknown as Database;

    const newPlain = await rotateRefreshToken(db, eventBus, oldPlain, 10, boundJkt);

    expect(newPlain).toBe(newBuf.toString('base64url'));
    expect(txInsertValues).toHaveBeenCalledWith(
      expect.objectContaining({
        dpopJkt: boundJkt,
        familyId: validRow.familyId,
      }),
    );
  });

  it('rotateRefreshToken throws when dpopJkt does not match a bound token', async () => {
    const oldPlain = 'mismatch-refresh';
    const oldHash = hashToken(oldPlain);

    const limit = vi.fn().mockResolvedValue([
      {
        id: 'row-m',
        token: oldHash,
        clientId: 'c1',
        userId: 'u1',
        scope: 'openid',
        expiresAt: new Date(Date.now() + 86_400_000),
        revokedAt: null,
        rotationGracePlaintext: null,
        dpopJkt: 'expected-jkt',
        familyId: 'fam-m',
        createdAt: new Date(Date.now() - 60_000),
      },
    ]);
    const whereSel = vi.fn().mockReturnValue({ limit });
    const fromSel = vi.fn().mockReturnValue({ where: whereSel });
    const select = vi.fn().mockReturnValue({ from: fromSel });

    const db = { select } as unknown as Database;

    await expect(rotateRefreshToken(db, eventBus, oldPlain, 10, 'wrong-jkt')).rejects.toSatisfy(
      (err: unknown) => err instanceof UnauthorizedError && err.message === 'DPoP binding mismatch',
    );
  });

  it('rotateRefreshToken with reused revoked token outside grace revokes family and throws', async () => {
    const oldPlain = 'reused-refresh';
    const oldHash = hashToken(oldPlain);
    const revokedAt = new Date(Date.now() - 60_000);

    const limit = vi.fn().mockResolvedValue([
      {
        id: 'row-1',
        token: oldHash,
        clientId: 'c1',
        userId: 'u1',
        scope: 'openid',
        expiresAt: new Date(Date.now() + 86_400_000),
        revokedAt,
        rotationGracePlaintext: 'grace',
        dpopJkt: null,
        familyId: 'fam-1',
        createdAt: new Date(Date.now() - 120_000),
      },
    ]);
    const whereSel = vi.fn().mockReturnValue({ limit });
    const fromSel = vi.fn().mockReturnValue({ where: whereSel });
    const select = vi.fn().mockReturnValue({ from: fromSel });

    const whereUp = vi.fn().mockResolvedValue(undefined);
    const set = vi.fn().mockReturnValue({ where: whereUp });
    const update = vi.fn().mockReturnValue({ set });

    const db = { select, update } as unknown as Database;

    const familyEvents: unknown[] = [];
    eventBus.subscribe(TOKEN_EVENTS.REFRESH_FAMILY_REVOKED, (e) => {
      familyEvents.push(e.payload);
    });

    await expect(rotateRefreshToken(db, eventBus, oldPlain, 10)).rejects.toThrow(
      'Refresh token reuse detected',
    );

    expect(update).toHaveBeenCalled();
    expect(familyEvents).toHaveLength(1);
  });

  it('rotateRefreshToken within grace rotates successor row and returns new plaintext without revoking family', async () => {
    const oldPlain = 'grace-refresh';
    const oldHash = hashToken(oldPlain);
    const successorPlain = 'same-successor-plain';
    const successorHash = hashToken(successorPlain);
    const graceBuf = Buffer.alloc(32, 0xef);
    vi.mocked(randomBytes).mockReturnValueOnce(graceBuf);

    const revokedAt = new Date();
    const now = Date.now();

    const revokedRow = {
      id: 'row-1',
      token: oldHash,
      clientId: 'c1',
      userId: 'u1',
      scope: 'openid',
      expiresAt: new Date(now + 86_400_000),
      revokedAt,
      rotationGracePlaintext: successorHash,
      dpopJkt: null,
      familyId: 'fam-1',
      createdAt: new Date(now - 60_000),
    };

    const childRow = {
      id: 'row-2',
      token: successorHash,
      clientId: 'c1',
      userId: 'u1',
      scope: 'openid',
      expiresAt: new Date(now + 86_400_000),
      revokedAt: null,
      rotationGracePlaintext: null,
      dpopJkt: null,
      familyId: 'fam-1',
      createdAt: new Date(now - 30_000),
    };

    const outerLimit = vi
      .fn()
      .mockResolvedValueOnce([revokedRow])
      .mockResolvedValueOnce([childRow]);
    const outerWhere = vi.fn().mockReturnValue({ limit: outerLimit });
    const outerFrom = vi.fn().mockReturnValue({ where: outerWhere });
    const outerSelect = vi.fn().mockReturnValue({ from: outerFrom });

    const txLimit = vi.fn().mockResolvedValue([childRow]);
    const txWhereSel = vi.fn().mockReturnValue({ limit: txLimit });
    const txFrom = vi.fn().mockReturnValue({ where: txWhereSel });
    const txSelect = vi.fn().mockReturnValue({ from: txFrom });

    const txInsertValues = vi.fn().mockResolvedValue(undefined);
    const txInsert = vi.fn().mockReturnValue({ values: txInsertValues });

    const txWhereUp = vi.fn().mockResolvedValue(undefined);
    const txSet = vi.fn().mockReturnValue({ where: txWhereUp });
    const txUpdate = vi.fn().mockReturnValue({ set: txSet });

    const transaction = vi.fn(async (fn: (tx: unknown) => Promise<void>) => {
      await fn({
        select: txSelect,
        update: txUpdate,
        insert: txInsert,
      });
    });

    const db = { select: outerSelect, transaction } as unknown as Database;

    const familyEvents: unknown[] = [];
    eventBus.subscribe(TOKEN_EVENTS.REFRESH_FAMILY_REVOKED, (e) => {
      familyEvents.push(e.payload);
    });

    const out = await rotateRefreshToken(db, eventBus, oldPlain, 10_000);

    expect(out).toBe(graceBuf.toString('base64url'));
    expect(txSet).toHaveBeenCalledWith(
      expect.objectContaining({
        rotationGracePlaintext: hashToken(graceBuf.toString('base64url')),
      }),
    );
    expect(familyEvents).toHaveLength(0);
  });

  it('revokeRefreshToken marks token as revoked', async () => {
    const plain = 'revoke-me';

    const returning = vi.fn().mockResolvedValue([
      {
        id: 'id-1',
        familyId: 'fam-1',
        clientId: 'c1',
        userId: 'u1',
      },
    ]);
    const whereUp = vi.fn().mockReturnValue({ returning });
    const set = vi.fn().mockReturnValue({ where: whereUp });
    const update = vi.fn().mockReturnValue({ set });

    const db = { update } as unknown as Database;

    const events: unknown[] = [];
    eventBus.subscribe(TOKEN_EVENTS.REFRESH_REVOKED, (e) => {
      events.push(e.payload);
    });

    await revokeRefreshToken(db, eventBus, plain);

    expect(set).toHaveBeenCalledWith({ revokedAt: expect.any(Date) as Date });
    expect(whereUp).toHaveBeenCalled();
    expect(events).toHaveLength(1);
    expect(events[0]).toMatchObject({ familyId: 'fam-1', clientId: 'c1', userId: 'u1' });
  });

  it('revokeAllForClient revokes all active tokens for client+user', async () => {
    const whereUp = vi.fn().mockResolvedValue(undefined);
    const set = vi.fn().mockReturnValue({ where: whereUp });
    const update = vi.fn().mockReturnValue({ set });

    const db = { update } as unknown as Database;

    const events: unknown[] = [];
    eventBus.subscribe(TOKEN_EVENTS.REFRESH_REVOKED, (e) => {
      events.push(e.payload);
    });

    await revokeAllForClient(db, eventBus, 'client-uuid', 'user-uuid');

    expect(set).toHaveBeenCalledWith({ revokedAt: expect.any(Date) as Date });
    expect(events).toHaveLength(1);
    expect(events[0]).toEqual({ clientId: 'client-uuid', userId: 'user-uuid' });
  });

  it('createRefreshTokenService delegates to underlying functions', async () => {
    const fixed = Buffer.alloc(32, 0x01);
    vi.mocked(randomBytes).mockReturnValueOnce(fixed);

    const values = vi.fn().mockResolvedValue(undefined);
    const insert = vi.fn().mockReturnValue({ values });
    const db = { insert } as unknown as Database;

    const service = createRefreshTokenService({ db, eventBus });
    const params = buildCreateRefreshTokenParams();

    const created = await service.createRefreshToken(params);
    expect(created.plaintext).toBe(fixed.toString('base64url'));
    expect(values).toHaveBeenCalled();
  });
});

describe('createDomainEvent for token', () => {
  it('builds REFRESH_ISSUED event', () => {
    const payload = { familyId: 'f', clientId: 'c', userId: 'u' };
    const event = createDomainEvent(TOKEN_EVENTS.REFRESH_ISSUED, payload);
    expect(event.eventName).toBe(TOKEN_EVENTS.REFRESH_ISSUED);
    expect(event.payload).toEqual(payload);
    expect(event.id).toBeTruthy();
  });
});
