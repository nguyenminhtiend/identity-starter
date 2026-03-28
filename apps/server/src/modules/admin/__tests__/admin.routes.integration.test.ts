import { permissions, roles, users } from '@identity-starter/db';
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

let testDb: TestDb;
let app: FastifyInstance;
let eventBus: InMemoryEventBus;
let adminToken: string;
let adminUserId: string;
let normalUserId: string;
let normalToken: string;

beforeAll(async () => {
  testDb = await createTestDb();
  eventBus = new InMemoryEventBus();
  app = await buildTestApp({ db: testDb.db, eventBus });

  // Seed system roles and permissions (not included in migrations)
  for (const name of ['super_admin', 'admin', 'user']) {
    await testDb.db
      .insert(roles)
      .values({ name, description: `System ${name} role`, isSystem: true })
      .onConflictDoNothing();
  }
  await testDb.db
    .insert(permissions)
    .values([
      { resource: 'users', action: 'read' },
      { resource: 'users', action: 'write' },
      { resource: 'roles', action: 'read' },
      { resource: 'roles', action: 'write' },
      { resource: 'sessions', action: 'read' },
      { resource: 'sessions', action: 'write' },
      { resource: 'audit', action: 'read' },
      { resource: 'audit', action: 'export' },
    ])
    .onConflictDoNothing();

  const adminUser = await createUser(testDb.db, eventBus, makeCreateUserInput());
  await testDb.db.update(users).set({ status: 'active' }).where(eq(users.id, adminUser.id));
  adminUserId = adminUser.id;

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
  normalUserId = normalUser.id;
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

describe('admin routes integration', () => {
  describe('user management', () => {
    it('GET /api/admin/users returns 200 with users', async () => {
      const res = await app.inject({
        method: 'GET',
        url: '/api/admin/users',
        headers: adminHeaders(),
      });
      expect(res.statusCode).toBe(200);
      const body = res.json();
      expect(body.data.length).toBeGreaterThan(0);
      expect(body.total).toBeGreaterThan(0);
    });

    it('GET /api/admin/users/:id returns 200 with user detail + roles', async () => {
      const res = await app.inject({
        method: 'GET',
        url: `/api/admin/users/${adminUserId}`,
        headers: adminHeaders(),
      });
      expect(res.statusCode).toBe(200);
      const body = res.json();
      expect(body.id).toBe(adminUserId);
      expect(body.roles.length).toBeGreaterThan(0);
    });

    it('PATCH /api/admin/users/:id/status suspends user', async () => {
      const target = await createUser(testDb.db, eventBus, makeCreateUserInput());
      await testDb.db.update(users).set({ status: 'active' }).where(eq(users.id, target.id));

      const res = await app.inject({
        method: 'PATCH',
        url: `/api/admin/users/${target.id}/status`,
        headers: adminHeaders(),
        payload: { status: 'suspended' },
      });
      expect(res.statusCode).toBe(200);
      expect(res.json().status).toBe('suspended');
    });

    it('PATCH /api/admin/users/:id/status reactivates user', async () => {
      const target = await createUser(testDb.db, eventBus, makeCreateUserInput());
      await testDb.db.update(users).set({ status: 'suspended' }).where(eq(users.id, target.id));

      const res = await app.inject({
        method: 'PATCH',
        url: `/api/admin/users/${target.id}/status`,
        headers: adminHeaders(),
        payload: { status: 'active' },
      });
      expect(res.statusCode).toBe(200);
      expect(res.json().status).toBe('active');
    });
  });

  describe('role management', () => {
    let customRoleId: string;

    it('POST /api/admin/roles creates custom role', async () => {
      const res = await app.inject({
        method: 'POST',
        url: '/api/admin/roles',
        headers: adminHeaders(),
        payload: { name: 'integration-test-role', description: 'Test role' },
      });
      expect(res.statusCode).toBe(201);
      const body = res.json();
      expect(body.name).toBe('integration-test-role');
      expect(body.isSystem).toBe(false);
      customRoleId = body.id;
    });

    it('GET /api/admin/roles returns all roles', async () => {
      const res = await app.inject({
        method: 'GET',
        url: '/api/admin/roles',
        headers: adminHeaders(),
      });
      expect(res.statusCode).toBe(200);
      const body = res.json();
      expect(body.length).toBeGreaterThanOrEqual(3);
      expect(body.some((r: { name: string }) => r.name === 'admin')).toBe(true);
    });

    it('PUT /api/admin/roles/:id/permissions sets permissions', async () => {
      const [firstPerm] = await testDb.db.select({ id: permissions.id }).from(permissions).limit(1);

      const res = await app.inject({
        method: 'PUT',
        url: `/api/admin/roles/${customRoleId}/permissions`,
        headers: adminHeaders(),
        payload: { permissionIds: [firstPerm.id] },
      });
      expect(res.statusCode).toBe(200);
    });

    it('POST /api/admin/users/:id/roles assigns role', async () => {
      const [userRole] = await testDb.db
        .select({ id: roles.id })
        .from(roles)
        .where(eq(roles.name, 'user'))
        .limit(1);

      const res = await app.inject({
        method: 'POST',
        url: `/api/admin/users/${normalUserId}/roles`,
        headers: adminHeaders(),
        payload: { roleId: userRole.id },
      });
      expect(res.statusCode).toBe(201);
    });

    it('DELETE /api/admin/users/:id/roles/:roleId removes role', async () => {
      const [userRole] = await testDb.db
        .select({ id: roles.id })
        .from(roles)
        .where(eq(roles.name, 'user'))
        .limit(1);

      const res = await app.inject({
        method: 'DELETE',
        url: `/api/admin/users/${normalUserId}/roles/${userRole.id}`,
        headers: adminHeaders(),
      });
      expect(res.statusCode).toBe(204);
    });
  });

  describe('session management', () => {
    it('GET /api/admin/sessions returns sessions', async () => {
      const res = await app.inject({
        method: 'GET',
        url: '/api/admin/sessions',
        headers: adminHeaders(),
      });
      expect(res.statusCode).toBe(200);
      expect(res.json().data.length).toBeGreaterThan(0);
    });

    it('DELETE /api/admin/sessions/:id revokes session', async () => {
      const target = await createUser(testDb.db, eventBus, makeCreateUserInput());
      await testDb.db.update(users).set({ status: 'active' }).where(eq(users.id, target.id));
      const session = await createSession(testDb.db, eventBus, { userId: target.id });

      const res = await app.inject({
        method: 'DELETE',
        url: `/api/admin/sessions/${session.id}`,
        headers: adminHeaders(),
      });
      expect(res.statusCode).toBe(204);
    });

    it('DELETE /api/admin/users/:id/sessions bulk revokes', async () => {
      const target = await createUser(testDb.db, eventBus, makeCreateUserInput());
      await testDb.db.update(users).set({ status: 'active' }).where(eq(users.id, target.id));
      await createSession(testDb.db, eventBus, { userId: target.id });
      await createSession(testDb.db, eventBus, { userId: target.id });

      const res = await app.inject({
        method: 'DELETE',
        url: `/api/admin/users/${target.id}/sessions`,
        headers: adminHeaders(),
      });
      expect(res.statusCode).toBe(200);
      expect(res.json().message).toMatch(/Revoked \d+ sessions/);
    });
  });

  describe('RBAC enforcement', () => {
    it('non-admin user gets 403 on admin routes', async () => {
      const res = await app.inject({
        method: 'GET',
        url: '/api/admin/users',
        headers: userHeaders(),
      });
      expect(res.statusCode).toBe(403);
    });
  });
});
