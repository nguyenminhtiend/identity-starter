import { signingKeys } from '@identity-starter/db';
import { eq } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createTestDb, type TestDb } from '../../../test/db-helper.js';
import { createSigningKeyService } from '../signing-key.service.js';

let testDb: TestDb;

beforeAll(async () => {
  testDb = await createTestDb();
});

afterAll(async () => {
  await testDb.teardown();
});

describe('signing key service integration', () => {
  it('generate → get active → rotate → JWKS contains both keys', async () => {
    const service = createSigningKeyService({ db: testDb.db });

    const first = await service.generateKeyPair();
    const activeAfterGenerate = await service.getActiveSigningKey();
    expect(activeAfterGenerate.kid).toBe(first.kid);

    const second = await service.rotateKey();
    expect(second.kid).not.toBe(first.kid);

    const activeAfterRotate = await service.getActiveSigningKey();
    expect(activeAfterRotate.kid).toBe(second.kid);

    const rows = await testDb.db.select().from(signingKeys).where(eq(signingKeys.kid, first.kid));
    expect(rows[0]?.status).toBe('rotated');

    const jwks = await service.getJwks();
    const kids = new Set(jwks.keys.map((k) => k.kid));
    expect(kids.has(first.kid)).toBe(true);
    expect(kids.has(second.kid)).toBe(true);
    for (const key of jwks.keys) {
      expect(key.use).toBe('sig');
      expect(key.alg).toBe('RS256');
    }
  });
});
