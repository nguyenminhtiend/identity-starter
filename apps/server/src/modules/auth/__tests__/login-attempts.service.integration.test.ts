import { loginAttempts } from '@identity-starter/db';
import { eq } from 'drizzle-orm';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { createTestDb, type TestDb } from '../../../test/db-helper.js';
import {
  getRecentFailureCount,
  pruneOldAttempts,
  recordAttempt,
} from '../login-attempts.service.js';

let testDb: TestDb;

beforeAll(async () => {
  testDb = await createTestDb();
});

afterAll(async () => {
  await testDb.teardown();
});

beforeEach(async () => {
  await testDb.db.delete(loginAttempts);
});

describe('recordAttempt', () => {
  it('inserts a row with the given fields', async () => {
    await recordAttempt(testDb.db, {
      email: 'user@example.com',
      ipAddress: '192.168.1.1',
      success: false,
    });

    const rows = await testDb.db
      .select()
      .from(loginAttempts)
      .where(eq(loginAttempts.email, 'user@example.com'));

    expect(rows).toHaveLength(1);
    expect(rows[0].ipAddress).toBe('192.168.1.1');
    expect(rows[0].success).toBe(false);
  });
});

describe('getRecentFailureCount', () => {
  it('counts only recent failures for the email', async () => {
    const email = 'failures@example.com';
    await recordAttempt(testDb.db, { email, ipAddress: '1.1.1.1', success: false });
    await recordAttempt(testDb.db, { email, ipAddress: '1.1.1.2', success: false });
    await recordAttempt(testDb.db, { email, ipAddress: '1.1.1.3', success: true });

    const count = await getRecentFailureCount(testDb.db, email);
    expect(count).toBe(2);
  });

  it('ignores successes when counting failures', async () => {
    const email = 'only-success@example.com';
    await recordAttempt(testDb.db, { email, ipAddress: '2.2.2.2', success: true });

    const count = await getRecentFailureCount(testDb.db, email);
    expect(count).toBe(0);
  });
});

describe('pruneOldAttempts', () => {
  it('returns 0 when there is nothing to delete', async () => {
    const deleted = await pruneOldAttempts(testDb.db);
    expect(deleted).toBe(0);
  });

  it('removes attempts at or before the 24h cutoff', async () => {
    const old = new Date(Date.now() - 25 * 60 * 60 * 1000);
    await testDb.db.insert(loginAttempts).values({
      email: 'old@example.com',
      ipAddress: '10.0.0.1',
      success: false,
      createdAt: old,
    });

    const deleted = await pruneOldAttempts(testDb.db);
    expect(deleted).toBe(1);

    const remaining = await testDb.db.select().from(loginAttempts);
    expect(remaining).toHaveLength(0);
  });
});
