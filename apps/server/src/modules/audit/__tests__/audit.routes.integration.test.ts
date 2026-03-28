import { createHash } from 'node:crypto';
import { roles, users } from '@identity-starter/db';
import { eq } from 'drizzle-orm';
import type { FastifyInstance } from 'fastify';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { InMemoryEventBus } from '../../../infra/event-bus.js';
import { buildTestApp } from '../../../test/app-builder.js';
import { createTestDb, type TestDb } from '../../../test/db-helper.js';
import { assignRole } from '../../rbac/rbac.service.js';
import { createSession } from '../../session/session.service.js';
import { makeCreateUserInput } from '../../user/__tests__/user.factory.js';
import { createUser } from '../../user/user.service.js';
import { createAuditLog, queryAuditLogs } from '../audit.service.js';
import { makeCreateAuditLogInput } from './audit.factory.js';

let testDb: TestDb;
let app: FastifyInstance;
let eventBus: InMemoryEventBus;
let adminToken: string;
let normalToken: string;

function computeHash(id: string, action: string, createdAt: Date): string {
  return createHash('sha256').update(`${id}${action}${createdAt.toISOString()}`).digest('hex');
}

beforeAll(async () => {
  testDb = await createTestDb();
  eventBus = new InMemoryEventBus();
  app = await buildTestApp({ db: testDb.db, eventBus });

  // Seed system roles (not included in migrations)
  for (const name of ['super_admin', 'admin', 'user']) {
    await testDb.db
      .insert(roles)
      .values({ name, description: `System ${name} role`, isSystem: true })
      .onConflictDoNothing();
  }

  const adminUser = await createUser(testDb.db, eventBus, makeCreateUserInput());
  await testDb.db.update(users).set({ status: 'active' }).where(eq(users.id, adminUser.id));
  const [superAdminRole] = await testDb.db
    .select({ id: roles.id })
    .from(roles)
    .where(eq(roles.name, 'super_admin'))
    .limit(1);
  await assignRole(testDb.db, eventBus, adminUser.id, superAdminRole.id, adminUser.id);
  const adminSession = await createSession(testDb.db, eventBus, { userId: adminUser.id });
  adminToken = adminSession.token;

  const normalUser = await createUser(testDb.db, eventBus, makeCreateUserInput());
  await testDb.db.update(users).set({ status: 'active' }).where(eq(users.id, normalUser.id));
  const normalSession = await createSession(testDb.db, eventBus, { userId: normalUser.id });
  normalToken = normalSession.token;
});

afterAll(async () => {
  await app.close();
  await testDb.teardown();
});

function adminHeaders() {
  return { authorization: `Bearer ${adminToken}` };
}

function userHeaders() {
  return { authorization: `Bearer ${normalToken}` };
}

describe('audit routes integration', () => {
  it('GET /api/admin/audit-logs returns paginated logs', async () => {
    await createAuditLog(testDb.db, makeCreateAuditLogInput({ action: 'test.query' }));

    const res = await app.inject({
      method: 'GET',
      url: '/api/admin/audit-logs',
      headers: adminHeaders(),
    });
    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body.data.length).toBeGreaterThan(0);
    expect(body.total).toBeGreaterThan(0);
  });

  it('GET /api/admin/audit-logs filters by action', async () => {
    const uniqueAction = `test.filter_${Date.now()}`;
    await createAuditLog(testDb.db, makeCreateAuditLogInput({ action: uniqueAction }));

    const res = await app.inject({
      method: 'GET',
      url: `/api/admin/audit-logs?action=${uniqueAction}`,
      headers: adminHeaders(),
    });
    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body.data.length).toBe(1);
    expect(body.data[0].action).toBe(uniqueAction);
  });

  it('GET /api/admin/audit-logs/export returns NDJSON', async () => {
    await createAuditLog(testDb.db, makeCreateAuditLogInput({ action: 'test.export' }));

    const res = await app.inject({
      method: 'GET',
      url: '/api/admin/audit-logs/export',
      headers: adminHeaders(),
    });
    expect(res.statusCode).toBe(200);
    expect(res.headers['content-type']).toContain('application/x-ndjson');
    const lines = res.body.split('\n').filter(Boolean);
    expect(lines.length).toBeGreaterThan(0);
    expect(() => JSON.parse(lines[0])).not.toThrow();
  });

  it('hash chain integrity is maintained', async () => {
    const all = await queryAuditLogs(testDb.db, { page: 1, limit: 1000 });
    if (all.data.length >= 2) {
      const sorted = [...all.data].sort(
        (a, b) => new Date(a.createdAt).getTime() - new Date(b.createdAt).getTime(),
      );
      expect(sorted[0].prevHash).toBeNull();
      for (let i = 1; i < sorted.length; i++) {
        const prev = sorted[i - 1];
        const expected = computeHash(prev.id, prev.action, new Date(prev.createdAt));
        expect(sorted[i].prevHash).toBe(expected);
      }
    }
  });

  it('non-admin user gets 403 on audit routes', async () => {
    const res = await app.inject({
      method: 'GET',
      url: '/api/admin/audit-logs',
      headers: userHeaders(),
    });
    expect(res.statusCode).toBe(403);
  });

  it('non-admin user gets 403 on export', async () => {
    const res = await app.inject({
      method: 'GET',
      url: '/api/admin/audit-logs/export',
      headers: userHeaders(),
    });
    expect(res.statusCode).toBe(403);
  });
});
