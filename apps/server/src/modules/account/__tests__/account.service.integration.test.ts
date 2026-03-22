import { NotFoundError, ValidationError } from '@identity-starter/core';
import { passkeys, sessions, users } from '@identity-starter/db';
import { eq } from 'drizzle-orm';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { type DomainEvent, InMemoryEventBus } from '../../../infra/event-bus.js';
import { createTestDb, type TestDb } from '../../../test/db-helper.js';
import { createSession } from '../../session/session.service.js';
import { makeCreateUserInput } from '../../user/__tests__/user.factory.js';
import { createUser } from '../../user/user.service.js';
import { ACCOUNT_EVENTS } from '../account.events.js';
import {
  deletePasskey,
  getProfile,
  listPasskeys,
  listSessions,
  renamePasskey,
  revokeOwnSession,
  updateProfile,
} from '../account.service.js';

let testDb: TestDb;
let eventBus: InMemoryEventBus;

beforeAll(async () => {
  testDb = await createTestDb();
});

afterAll(async () => {
  await testDb.teardown();
});

beforeEach(() => {
  eventBus = new InMemoryEventBus();
});

async function seedUser(withPasswordHash: boolean) {
  const input = makeCreateUserInput();
  const user = await createUser(testDb.db, eventBus, input);
  if (withPasswordHash) {
    await testDb.db
      .update(users)
      .set({ passwordHash: '$argon2id$v=19$m=65536,t=3,p=4$fake' })
      .where(eq(users.id, user.id));
  }
  const session = await createSession(testDb.db, eventBus, {
    userId: user.id,
    ipAddress: '127.0.0.1',
    userAgent: 'integration',
  });
  return { user, sessionId: session.id };
}

describe('getProfile', () => {
  it('returns profile for existing user', async () => {
    const { user } = await seedUser(false);
    const profile = await getProfile(testDb.db, user.id);
    expect(profile.id).toBe(user.id);
    expect(profile.email).toBe(user.email);
    expect(profile.displayName).toBe(user.displayName);
    expect(profile).not.toHaveProperty('passwordHash');
    expect(profile).not.toHaveProperty('updatedAt');
  });

  it('throws NotFoundError when user missing', async () => {
    await expect(getProfile(testDb.db, '00000000-0000-0000-0000-000000000000')).rejects.toThrow(
      NotFoundError,
    );
  });
});

describe('updateProfile', () => {
  it('updates fields and emits event when patch non-empty', async () => {
    const { user } = await seedUser(false);
    const collected: DomainEvent[] = [];
    eventBus.subscribe(ACCOUNT_EVENTS.PROFILE_UPDATED, (e) => {
      collected.push(e);
    });

    const nextName = 'Updated Name';
    const profile = await updateProfile(testDb.db, eventBus, user.id, {
      displayName: nextName,
      metadata: { tier: 'pro' },
    });

    expect(profile.displayName).toBe(nextName);
    expect(profile.metadata).toEqual({ tier: 'pro' });
    expect(collected).toHaveLength(1);
    expect(collected[0].payload).toEqual({ userId: user.id });
  });

  it('does not emit when no fields provided', async () => {
    const { user } = await seedUser(false);
    const collected: DomainEvent[] = [];
    eventBus.subscribe(ACCOUNT_EVENTS.PROFILE_UPDATED, (e) => {
      collected.push(e);
    });

    await updateProfile(testDb.db, eventBus, user.id, {});

    expect(collected).toHaveLength(0);
  });
});

describe('listSessions', () => {
  it('marks current session', async () => {
    const { user, sessionId } = await seedUser(false);
    const other = await createSession(testDb.db, eventBus, {
      userId: user.id,
      ipAddress: '10.0.0.1',
      userAgent: 'other',
    });

    const list = await listSessions(testDb.db, user.id, sessionId);
    expect(list).toHaveLength(2);
    const current = list.find((s) => s.id === sessionId);
    const second = list.find((s) => s.id === other.id);
    expect(current?.isCurrent).toBe(true);
    expect(second?.isCurrent).toBe(false);
  });
});

describe('revokeOwnSession', () => {
  it('throws ValidationError for current session', async () => {
    const { user, sessionId } = await seedUser(false);
    await expect(
      revokeOwnSession(testDb.db, eventBus, user.id, sessionId, sessionId),
    ).rejects.toThrow(ValidationError);
  });

  it('revokes another session and emits event', async () => {
    const { user, sessionId } = await seedUser(false);
    const other = await createSession(testDb.db, eventBus, {
      userId: user.id,
      ipAddress: '10.0.0.2',
      userAgent: 'other',
    });

    const collected: DomainEvent[] = [];
    eventBus.subscribe(ACCOUNT_EVENTS.SESSION_REVOKED, (e) => {
      collected.push(e);
    });

    await revokeOwnSession(testDb.db, eventBus, user.id, other.id, sessionId);

    const remaining = await testDb.db
      .select({ id: sessions.id })
      .from(sessions)
      .where(eq(sessions.userId, user.id));

    expect(remaining.map((r) => r.id)).toEqual([sessionId]);
    expect(collected).toHaveLength(1);
    expect(collected[0].payload).toEqual({ sessionId: other.id, userId: user.id });
  });

  it('throws NotFound for other user session id', async () => {
    const { user, sessionId } = await seedUser(false);
    const { user: otherUser } = await seedUser(false);
    const otherSession = await createSession(testDb.db, eventBus, {
      userId: otherUser.id,
      ipAddress: '10.0.0.3',
      userAgent: 'x',
    });

    await expect(
      revokeOwnSession(testDb.db, eventBus, user.id, otherSession.id, sessionId),
    ).rejects.toThrow(NotFoundError);
  });
});

describe('listPasskeys', () => {
  it('returns passkeys without public key', async () => {
    const { user } = await seedUser(false);
    await testDb.db.insert(passkeys).values({
      userId: user.id,
      credentialId: `cred-${user.id.slice(0, 8)}`,
      publicKey: new Uint8Array([1, 2, 3]),
      counter: 0,
      deviceType: 'multiDevice',
      backedUp: false,
      transports: ['internal'],
      name: 'Primary',
      aaguid: '00000000-0000-0000-0000-000000000000',
    });

    const list = await listPasskeys(testDb.db, user.id);
    expect(list).toHaveLength(1);
    expect(list[0].credentialId).toContain('cred-');
    expect(list[0].name).toBe('Primary');
    expect(list[0]).not.toHaveProperty('publicKey');
  });
});

describe('renamePasskey', () => {
  it('renames owned passkey', async () => {
    const { user } = await seedUser(false);
    const [inserted] = await testDb.db
      .insert(passkeys)
      .values({
        userId: user.id,
        credentialId: `rename-${user.id.slice(0, 8)}`,
        publicKey: new Uint8Array([9]),
        counter: 0,
        deviceType: 'singleDevice',
        backedUp: true,
        name: 'Old',
      })
      .returning({ id: passkeys.id });

    const collected: DomainEvent[] = [];
    eventBus.subscribe(ACCOUNT_EVENTS.PASSKEY_RENAMED, (e) => {
      collected.push(e);
    });

    const updated = await renamePasskey(testDb.db, eventBus, user.id, inserted.id, 'New label');

    expect(updated.name).toBe('New label');
    expect(collected).toHaveLength(1);
  });

  it('throws NotFound when passkey belongs to another user', async () => {
    const { user } = await seedUser(false);
    const { user: other } = await seedUser(false);
    const [pk] = await testDb.db
      .insert(passkeys)
      .values({
        userId: other.id,
        credentialId: `other-${other.id.slice(0, 8)}`,
        publicKey: new Uint8Array([1]),
        counter: 0,
        deviceType: 'singleDevice',
        backedUp: false,
      })
      .returning({ id: passkeys.id });

    await expect(renamePasskey(testDb.db, eventBus, user.id, pk.id, 'x')).rejects.toThrow(
      NotFoundError,
    );
  });
});

describe('deletePasskey', () => {
  it('deletes when user has password', async () => {
    const { user } = await seedUser(true);
    const [pk] = await testDb.db
      .insert(passkeys)
      .values({
        userId: user.id,
        credentialId: `del-${user.id.slice(0, 8)}`,
        publicKey: new Uint8Array([3]),
        counter: 0,
        deviceType: 'singleDevice',
        backedUp: false,
      })
      .returning({ id: passkeys.id });

    const collected: DomainEvent[] = [];
    eventBus.subscribe(ACCOUNT_EVENTS.PASSKEY_DELETED, (e) => {
      collected.push(e);
    });

    await deletePasskey(testDb.db, eventBus, user.id, pk.id);

    const remaining = await testDb.db.select().from(passkeys).where(eq(passkeys.userId, user.id));
    expect(remaining).toHaveLength(0);
    expect(collected).toHaveLength(1);
  });

  it('throws when last passkey and no password', async () => {
    const { user } = await seedUser(false);
    const [pk] = await testDb.db
      .insert(passkeys)
      .values({
        userId: user.id,
        credentialId: `last-${user.id.slice(0, 8)}`,
        publicKey: new Uint8Array([4]),
        counter: 0,
        deviceType: 'singleDevice',
        backedUp: false,
      })
      .returning({ id: passkeys.id });

    await expect(deletePasskey(testDb.db, eventBus, user.id, pk.id)).rejects.toThrow(
      ValidationError,
    );
  });

  it('allows delete when multiple passkeys and no password', async () => {
    const { user } = await seedUser(false);
    await testDb.db.insert(passkeys).values([
      {
        userId: user.id,
        credentialId: `m1-${user.id.slice(0, 8)}`,
        publicKey: new Uint8Array([5]),
        counter: 0,
        deviceType: 'singleDevice',
        backedUp: false,
      },
      {
        userId: user.id,
        credentialId: `m2-${user.id.slice(0, 8)}`,
        publicKey: new Uint8Array([6]),
        counter: 0,
        deviceType: 'singleDevice',
        backedUp: false,
      },
    ]);

    const rows = await testDb.db
      .select({ id: passkeys.id })
      .from(passkeys)
      .where(eq(passkeys.userId, user.id));

    await deletePasskey(testDb.db, eventBus, user.id, rows[0].id);

    const left = await testDb.db.select().from(passkeys).where(eq(passkeys.userId, user.id));
    expect(left).toHaveLength(1);
  });
});
