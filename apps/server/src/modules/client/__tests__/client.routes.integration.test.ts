import { users } from '@identity-starter/db';
import { eq } from 'drizzle-orm';
import type { FastifyInstance } from 'fastify';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { InMemoryEventBus } from '../../../infra/event-bus.js';
import { buildTestApp } from '../../../test/app-builder.js';
import { createTestDb, type TestDb } from '../../../test/db-helper.js';
import { createSession } from '../../session/session.service.js';
import { makeCreateUserInput } from '../../user/__tests__/user.factory.js';
import { createUser } from '../../user/user.service.js';
import { buildCreateClientInput } from './client.factory.js';

let testDb: TestDb;
let app: FastifyInstance;
let eventBus: InMemoryEventBus;
let adminToken: string;
let userToken: string;

beforeAll(async () => {
  testDb = await createTestDb();
  eventBus = new InMemoryEventBus();
  app = await buildTestApp({ db: testDb.db, eventBus });

  const adminUser = await createUser(testDb.db, eventBus, makeCreateUserInput());
  await testDb.db
    .update(users)
    .set({ isAdmin: true, status: 'active' })
    .where(eq(users.id, adminUser.id));
  const adminSession = await createSession(testDb.db, eventBus, { userId: adminUser.id });
  adminToken = adminSession.token;

  const normalUser = await createUser(testDb.db, eventBus, makeCreateUserInput());
  const userSession = await createSession(testDb.db, eventBus, { userId: normalUser.id });
  userToken = userSession.token;
});

afterAll(async () => {
  await app.close();
  await testDb.teardown();
});

function adminHeaders() {
  return { authorization: `Bearer ${adminToken}` };
}

describe('client routes integration', () => {
  it('full admin lifecycle', async () => {
    const createPayload = buildCreateClientInput({ clientName: 'Integration Client' });

    const createRes = await app.inject({
      method: 'POST',
      url: '/api/admin/clients',
      headers: adminHeaders(),
      payload: createPayload,
    });
    expect(createRes.statusCode).toBe(201);
    const created = createRes.json() as { id: string; clientId: string; clientSecret: string };
    expect(created.clientSecret).toBeDefined();
    expect(created.clientName).toBe('Integration Client');

    const listRes = await app.inject({
      method: 'GET',
      url: '/api/admin/clients',
      headers: adminHeaders(),
    });
    expect(listRes.statusCode).toBe(200);
    const list = listRes.json() as Array<{ id: string }>;
    expect(list.some((c) => c.id === created.id)).toBe(true);

    const getRes = await app.inject({
      method: 'GET',
      url: `/api/admin/clients/${created.id}`,
      headers: adminHeaders(),
    });
    expect(getRes.statusCode).toBe(200);
    expect((getRes.json() as { id: string }).id).toBe(created.id);

    const patchRes = await app.inject({
      method: 'PATCH',
      url: `/api/admin/clients/${created.id}`,
      headers: adminHeaders(),
      payload: { clientName: 'Updated Integration Client' },
    });
    expect(patchRes.statusCode).toBe(200);
    expect((patchRes.json() as { clientName: string }).clientName).toBe(
      'Updated Integration Client',
    );

    const rotateRes = await app.inject({
      method: 'POST',
      url: `/api/admin/clients/${created.id}/rotate-secret`,
      headers: adminHeaders(),
    });
    expect(rotateRes.statusCode).toBe(200);
    const rotated = rotateRes.json() as { clientSecret: string };
    expect(rotated.clientSecret).toBeDefined();
    expect(rotated.clientSecret).not.toBe(created.clientSecret);

    const delRes = await app.inject({
      method: 'DELETE',
      url: `/api/admin/clients/${created.id}`,
      headers: adminHeaders(),
    });
    expect(delRes.statusCode).toBe(204);

    const gone = await app.inject({
      method: 'GET',
      url: `/api/admin/clients/${created.id}`,
      headers: adminHeaders(),
    });
    expect(gone.statusCode).toBe(404);
  });

  it('returns 401 without Authorization header', async () => {
    const response = await app.inject({
      method: 'GET',
      url: '/api/admin/clients',
    });
    expect(response.statusCode).toBe(401);
  });

  it('returns 403 for non-admin session', async () => {
    const response = await app.inject({
      method: 'GET',
      url: '/api/admin/clients',
      headers: { authorization: `Bearer ${userToken}` },
    });
    expect(response.statusCode).toBe(403);
  });
});
