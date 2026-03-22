import { createHash } from 'node:crypto';
import { auditLogs } from '@identity-starter/db';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { createTestDb, type TestDb } from '../../../test/db-helper.js';
import { createAuditLog, exportAuditLogs, queryAuditLogs } from '../audit.service.js';
import { makeCreateAuditLogInput } from './audit.factory.js';

function computeHash(id: string, action: string, createdAt: Date): string {
  return createHash('sha256').update(`${id}${action}${createdAt.toISOString()}`).digest('hex');
}

let testDb: TestDb;

beforeAll(async () => {
  testDb = await createTestDb();
});

afterAll(async () => {
  await testDb.teardown();
});

beforeEach(async () => {
  await testDb.db.delete(auditLogs);
});

describe('createAuditLog', () => {
  it('first entry has prevHash null', async () => {
    const entry = await createAuditLog(testDb.db, makeCreateAuditLogInput());

    expect(entry.prevHash).toBeNull();
    expect(entry.id).toBeDefined();
    expect(entry.createdAt).toBeInstanceOf(Date);
  });

  it('second entry has prevHash = SHA-256 of first entry fields', async () => {
    const first = await createAuditLog(testDb.db, makeCreateAuditLogInput());
    const second = await createAuditLog(testDb.db, makeCreateAuditLogInput());

    const expectedHash = computeHash(first.id, first.action, first.createdAt);
    expect(second.prevHash).toBe(expectedHash);
  });

  it('third entry hash chains from second', async () => {
    const first = await createAuditLog(testDb.db, makeCreateAuditLogInput());
    const second = await createAuditLog(testDb.db, makeCreateAuditLogInput());
    const third = await createAuditLog(testDb.db, makeCreateAuditLogInput());

    const hashOfFirst = computeHash(first.id, first.action, first.createdAt);
    const hashOfSecond = computeHash(second.id, second.action, second.createdAt);

    expect(second.prevHash).toBe(hashOfFirst);
    expect(third.prevHash).toBe(hashOfSecond);
  });
});

describe('hash chain verification', () => {
  it('verifies hash chain across 5 entries', async () => {
    const entries = [];
    for (let i = 0; i < 5; i++) {
      const entry = await createAuditLog(
        testDb.db,
        makeCreateAuditLogInput({ action: `action.${i}` }),
      );
      entries.push(entry);
    }

    expect(entries[0].prevHash).toBeNull();

    for (let i = 1; i < entries.length; i++) {
      const prev = entries[i - 1];
      const expected = computeHash(prev.id, prev.action, prev.createdAt);
      expect(entries[i].prevHash).toBe(expected);
    }
  });
});

describe('queryAuditLogs', () => {
  const actorA = '00000000-0000-0000-0000-00000000000a';
  const actorB = '00000000-0000-0000-0000-00000000000b';

  async function seed25Entries() {
    for (let i = 0; i < 25; i++) {
      await createAuditLog(
        testDb.db,
        makeCreateAuditLogInput({
          actorId: i < 15 ? actorA : actorB,
          action: i < 10 ? 'auth.login' : 'admin.action',
          resourceType: 'user',
        }),
      );
    }
  }

  it('returns page 1 with limit 10 from 25 entries', async () => {
    await seed25Entries();

    const result = await queryAuditLogs(testDb.db, { page: 1, limit: 10 });

    expect(result.data).toHaveLength(10);
    expect(result.total).toBe(25);
    expect(result.page).toBe(1);
    expect(result.limit).toBe(10);
  });

  it('filters by actorId', async () => {
    await seed25Entries();

    const result = await queryAuditLogs(testDb.db, { page: 1, limit: 50, actorId: actorA });

    expect(result.total).toBe(15);
    for (const entry of result.data) {
      expect(entry.actorId).toBe(actorA);
    }
  });

  it('filters by action', async () => {
    await seed25Entries();

    const result = await queryAuditLogs(testDb.db, { page: 1, limit: 50, action: 'auth.login' });

    expect(result.total).toBe(10);
    for (const entry of result.data) {
      expect(entry.action).toBe('auth.login');
    }
  });

  it('filters by date range', async () => {
    await seed25Entries();

    const result = await queryAuditLogs(testDb.db, {
      page: 1,
      limit: 50,
      startDate: new Date(Date.now() - 60_000),
      endDate: new Date(Date.now() + 60_000),
    });

    expect(result.total).toBe(25);
  });

  it('excludes entries outside date range', async () => {
    await seed25Entries();

    const farPast = new Date('2000-01-01T00:00:00.000Z');
    const stillPast = new Date('2000-01-02T00:00:00.000Z');

    const result = await queryAuditLogs(testDb.db, {
      page: 1,
      limit: 50,
      startDate: farPast,
      endDate: stillPast,
    });

    expect(result.total).toBe(0);
    expect(result.data).toHaveLength(0);
  });

  it('combines filters correctly', async () => {
    await seed25Entries();

    const result = await queryAuditLogs(testDb.db, {
      page: 1,
      limit: 50,
      actorId: actorA,
      action: 'auth.login',
    });

    expect(result.total).toBe(10);
    for (const entry of result.data) {
      expect(entry.actorId).toBe(actorA);
      expect(entry.action).toBe('auth.login');
    }
  });
});

describe('exportAuditLogs', () => {
  it('returns all entries in chronological order', async () => {
    for (let i = 0; i < 5; i++) {
      await createAuditLog(testDb.db, makeCreateAuditLogInput({ action: `export.${i}` }));
    }

    const rows = await exportAuditLogs(testDb.db, {});

    expect(rows).toHaveLength(5);
    for (let i = 1; i < rows.length; i++) {
      expect(rows[i].createdAt.getTime()).toBeGreaterThanOrEqual(rows[i - 1].createdAt.getTime());
    }
  });

  it('applies filters same as query', async () => {
    const actorId = '00000000-0000-0000-0000-000000000099';
    for (let i = 0; i < 3; i++) {
      await createAuditLog(testDb.db, makeCreateAuditLogInput({ actorId }));
    }
    for (let i = 0; i < 2; i++) {
      await createAuditLog(testDb.db, makeCreateAuditLogInput());
    }

    const rows = await exportAuditLogs(testDb.db, { actorId });

    expect(rows).toHaveLength(3);
    for (const row of rows) {
      expect(row.actorId).toBe(actorId);
    }
  });
});
