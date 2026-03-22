import { oauthClients, refreshTokens, users } from '@identity-starter/db';
import { and, eq } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { InMemoryEventBus } from '../../../infra/event-bus.js';
import { createTestDb, type TestDb } from '../../../test/db-helper.js';
import { createRefreshTokenService, hashToken } from '../refresh-token.service.js';

let testDb: TestDb;

beforeAll(async () => {
  testDb = await createTestDb();
});

afterAll(async () => {
  await testDb.teardown();
});

describe('refresh token service integration', () => {
  it('create → rotate → old revoked; grace replay returns same successor; reuse after grace revokes family', async () => {
    const eventBus = new InMemoryEventBus();
    const service = createRefreshTokenService({ db: testDb.db, eventBus });

    const [user] = await testDb.db
      .insert(users)
      .values({
        email: 'refresh-int@example.com',
        displayName: 'Refresh Int',
        passwordHash: 'fake-hash',
      })
      .returning();

    const [client] = await testDb.db
      .insert(oauthClients)
      .values({
        clientId: 'test-client-refresh-int',
        clientSecretHash: 'fake-hash',
        clientName: 'Test Client',
        redirectUris: ['https://example.com/callback'],
        grantTypes: ['authorization_code', 'refresh_token'],
        responseTypes: ['code'],
        scope: 'openid profile email',
        tokenEndpointAuthMethod: 'client_secret_basic',
        isConfidential: true,
      })
      .returning();

    if (!user || !client) {
      throw new Error('fixture insert failed');
    }

    const { plaintext: firstPlain, familyId } = await service.createRefreshToken({
      clientId: client.id,
      userId: user.id,
      scope: 'openid profile',
      expiresInSeconds: 3600,
    });

    expect(firstPlain.length).toBeGreaterThan(0);
    expect(familyId).toBeTruthy();

    const storedFirst = await testDb.db
      .select()
      .from(refreshTokens)
      .where(eq(refreshTokens.token, hashToken(firstPlain)));
    expect(storedFirst).toHaveLength(1);
    expect(storedFirst[0]?.revokedAt).toBeNull();

    const secondPlain = await service.rotateRefreshToken(firstPlain, 10);
    expect(secondPlain).not.toBe(firstPlain);

    const oldRow = await testDb.db
      .select()
      .from(refreshTokens)
      .where(eq(refreshTokens.token, hashToken(firstPlain)));
    expect(oldRow[0]?.revokedAt).not.toBeNull();
    expect(oldRow[0]?.rotationGracePlaintext).toBe(secondPlain);

    const graceAgain = await service.rotateRefreshToken(firstPlain, 10);
    expect(graceAgain).toBe(secondPlain);

    const agedRevokedAt = new Date(Date.now() - 15_000);
    await testDb.db
      .update(refreshTokens)
      .set({ revokedAt: agedRevokedAt })
      .where(eq(refreshTokens.token, hashToken(firstPlain)));

    await expect(service.rotateRefreshToken(firstPlain, 10)).rejects.toMatchObject({
      name: 'UnauthorizedError',
      message: 'Refresh token reuse detected',
    });

    const familyRows = await testDb.db
      .select()
      .from(refreshTokens)
      .where(eq(refreshTokens.familyId, familyId));
    for (const r of familyRows) {
      expect(r.revokedAt).not.toBeNull();
    }
  });

  it('revokeRefreshToken marks one row; revokeAllForClient clears remaining for pair', async () => {
    const eventBus = new InMemoryEventBus();
    const service = createRefreshTokenService({ db: testDb.db, eventBus });

    const [user] = await testDb.db
      .insert(users)
      .values({
        email: 'refresh-revoke@example.com',
        displayName: 'Revoke User',
        passwordHash: 'fake-hash',
      })
      .returning();

    const [client] = await testDb.db
      .insert(oauthClients)
      .values({
        clientId: 'test-client-revoke-all',
        clientSecretHash: 'fake-hash',
        clientName: 'Revoke Client',
        redirectUris: ['https://example.com/cb'],
        grantTypes: ['authorization_code', 'refresh_token'],
        responseTypes: ['code'],
        scope: 'openid',
        tokenEndpointAuthMethod: 'client_secret_basic',
        isConfidential: true,
      })
      .returning();

    if (!user || !client) {
      throw new Error('fixture insert failed');
    }

    const { plaintext: a } = await service.createRefreshToken({
      clientId: client.id,
      userId: user.id,
      scope: 'openid',
      expiresInSeconds: 3600,
    });

    const { plaintext: b } = await service.createRefreshToken({
      clientId: client.id,
      userId: user.id,
      scope: 'openid',
      expiresInSeconds: 3600,
    });

    await service.revokeRefreshToken(a);

    const rowA = await testDb.db
      .select()
      .from(refreshTokens)
      .where(eq(refreshTokens.token, hashToken(a)));
    expect(rowA[0]?.revokedAt).not.toBeNull();

    const rowB = await testDb.db
      .select()
      .from(refreshTokens)
      .where(eq(refreshTokens.token, hashToken(b)));
    expect(rowB[0]?.revokedAt).toBeNull();

    await service.revokeAllForClient(client.id, user.id);

    const active = await testDb.db
      .select()
      .from(refreshTokens)
      .where(and(eq(refreshTokens.clientId, client.id), eq(refreshTokens.userId, user.id)));
    for (const r of active) {
      expect(r.revokedAt).not.toBeNull();
    }
  });
});
