import { mfaChallenges, recoveryCodes, totpSecrets } from '@identity-starter/db';
import { and, eq, isNull } from 'drizzle-orm';
import * as OTPAuth from 'otpauth';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { InMemoryEventBus } from '../../../infra/event-bus.js';
import { createTestDb, type TestDb } from '../../../test/db-helper.js';
import {
  checkMfaEnrolled,
  disableTotp,
  enrollTotp,
  regenerateRecoveryCodes,
  verifyMfaChallenge,
  verifyTotpEnrollment,
} from '../mfa.service.js';
import {
  createMfaChallengeRow,
  createUserWithPassword,
  enrollAndVerifyTotp,
} from './mfa.factory.js';

let testDb: TestDb;
let eventBus: InMemoryEventBus;

beforeAll(async () => {
  process.env.TOTP_ENCRYPTION_KEY = process.env.TOTP_ENCRYPTION_KEY ?? 'a'.repeat(64);
  testDb = await createTestDb();
});

afterAll(async () => {
  await testDb.teardown();
});

beforeEach(() => {
  eventBus = new InMemoryEventBus();
});

describe('MFA service integration', () => {
  it('enrolls TOTP, verifies OTP, and marks secret verified', async () => {
    const password = 'integration-pass-1';
    const { user } = await createUserWithPassword(testDb.db, eventBus, password);
    const { otpauthUri } = await enrollTotp(testDb.db, eventBus, user.id);
    const parsed = OTPAuth.URI.parse(otpauthUri);
    if (!(parsed instanceof OTPAuth.TOTP)) {
      throw new Error('expected TOTP');
    }
    const otp = parsed.generate();

    await verifyTotpEnrollment(testDb.db, eventBus, user.id, otp);

    const [row] = await testDb.db
      .select()
      .from(totpSecrets)
      .where(eq(totpSecrets.userId, user.id))
      .limit(1);

    expect(row?.verified).toBe(true);
    await expect(checkMfaEnrolled(testDb.db, user.id)).resolves.toBe(true);
  });

  it('disableTotp removes TOTP and recovery codes', async () => {
    const password = 'integration-pass-2';
    const { user } = await createUserWithPassword(testDb.db, eventBus, password);
    await enrollAndVerifyTotp(testDb.db, eventBus, user.id);

    await disableTotp(testDb.db, eventBus, user.id, password);

    const totpRows = await testDb.db
      .select()
      .from(totpSecrets)
      .where(eq(totpSecrets.userId, user.id));
    const rcRows = await testDb.db
      .select()
      .from(recoveryCodes)
      .where(eq(recoveryCodes.userId, user.id));
    expect(totpRows).toHaveLength(0);
    expect(rcRows).toHaveLength(0);
    await expect(checkMfaEnrolled(testDb.db, user.id)).resolves.toBe(false);
  });

  it('regenerateRecoveryCodes invalidates previous recovery codes', async () => {
    const password = 'integration-pass-3';
    const { user } = await createUserWithPassword(testDb.db, eventBus, password);
    const { recoveryCodes: firstCodes } = await enrollAndVerifyTotp(testDb.db, eventBus, user.id);

    const newCodes = await regenerateRecoveryCodes(testDb.db, eventBus, user.id, password);
    expect(newCodes).toHaveLength(8);
    expect(newCodes[0]).not.toBe(firstCodes[0]);

    const token = 'mfa-int-token-1';
    await createMfaChallengeRow(testDb.db, {
      userId: user.id,
      token,
      expiresAt: new Date(Date.now() + 120_000),
    });

    await expect(
      verifyMfaChallenge(testDb.db, eventBus, { mfaToken: token, recoveryCode: firstCodes[0] }, {}),
    ).rejects.toThrow('Invalid recovery code');

    const token2 = 'mfa-int-token-2';
    await createMfaChallengeRow(testDb.db, {
      userId: user.id,
      token: token2,
      expiresAt: new Date(Date.now() + 120_000),
    });

    const result = await verifyMfaChallenge(
      testDb.db,
      eventBus,
      { mfaToken: token2, recoveryCode: newCodes[0] },
      {},
    );
    expect(result.token).toBeDefined();
    expect(result.user.id).toBe(user.id);
  });

  it('verifyMfaChallenge with OTP creates a session', async () => {
    const password = 'integration-pass-4';
    const { user } = await createUserWithPassword(testDb.db, eventBus, password);
    const { otpauthUri } = await enrollAndVerifyTotp(testDb.db, eventBus, user.id);
    const parsed = OTPAuth.URI.parse(otpauthUri);
    if (!(parsed instanceof OTPAuth.TOTP)) {
      throw new Error('expected TOTP');
    }

    const token = 'mfa-int-token-otp';
    await createMfaChallengeRow(testDb.db, {
      userId: user.id,
      token,
      expiresAt: new Date(Date.now() + 120_000),
    });

    const otp = parsed.generate();
    const result = await verifyMfaChallenge(
      testDb.db,
      eventBus,
      { mfaToken: token, otp },
      { ipAddress: '127.0.0.1' },
    );

    expect(result.user.email).toBeDefined();
    expect(result.token.length).toBeGreaterThan(10);

    const [used] = await testDb.db
      .select()
      .from(mfaChallenges)
      .where(eq(mfaChallenges.token, token))
      .limit(1);
    expect(used?.usedAt).not.toBeNull();
  });

  it('verifyMfaChallenge consumes a recovery code', async () => {
    const password = 'integration-pass-5';
    const { user } = await createUserWithPassword(testDb.db, eventBus, password);
    const { recoveryCodes: codes } = await enrollAndVerifyTotp(testDb.db, eventBus, user.id);

    const token = 'mfa-int-token-rc';
    await createMfaChallengeRow(testDb.db, {
      userId: user.id,
      token,
      expiresAt: new Date(Date.now() + 120_000),
    });

    await verifyMfaChallenge(testDb.db, eventBus, { mfaToken: token, recoveryCode: codes[0] }, {});

    const unused = await testDb.db
      .select()
      .from(recoveryCodes)
      .where(and(eq(recoveryCodes.userId, user.id), isNull(recoveryCodes.usedAt)));

    expect(unused).toHaveLength(7);
  });
});
