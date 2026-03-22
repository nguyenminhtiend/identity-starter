import { totpSecrets } from '@identity-starter/db';
import { eq } from 'drizzle-orm';
import type { FastifyInstance } from 'fastify';
import * as OTPAuth from 'otpauth';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { buildTestApp } from '../../../test/app-builder.js';
import { createTestDb, type TestDb } from '../../../test/db-helper.js';
import { makeRegisterInput } from '../../auth/__tests__/auth.factory.js';

let testDb: TestDb;
let app: FastifyInstance;

beforeAll(async () => {
  process.env.TOTP_ENCRYPTION_KEY = process.env.TOTP_ENCRYPTION_KEY ?? 'a'.repeat(64);
  testDb = await createTestDb();
  app = await buildTestApp({ db: testDb.db });
});

afterAll(async () => {
  await app.close();
  await testDb.teardown();
});

describe('MFA routes integration', () => {
  it('full TOTP enroll and verify lifecycle', async () => {
    const input = makeRegisterInput();
    const reg = await app.inject({
      method: 'POST',
      url: '/api/auth/register',
      payload: input,
    });
    expect(reg.statusCode).toBe(201);
    const authToken = reg.json().token as string;

    const enroll = await app.inject({
      method: 'POST',
      url: '/api/account/mfa/totp/enroll',
      headers: { authorization: `Bearer ${authToken}` },
    });
    expect(enroll.statusCode).toBe(200);
    const { otpauthUri } = enroll.json() as { otpauthUri: string };

    const parsed = OTPAuth.URI.parse(otpauthUri);
    if (!(parsed instanceof OTPAuth.TOTP)) {
      throw new Error('expected TOTP');
    }
    const otp = parsed.generate();

    const verify = await app.inject({
      method: 'POST',
      url: '/api/account/mfa/totp/verify',
      headers: { authorization: `Bearer ${authToken}` },
      payload: { otp },
    });
    expect(verify.statusCode).toBe(200);

    const userId = reg.json().user.id as string;
    const [row] = await testDb.db
      .select()
      .from(totpSecrets)
      .where(eq(totpSecrets.userId, userId))
      .limit(1);
    expect(row?.verified).toBe(true);
  });
});
