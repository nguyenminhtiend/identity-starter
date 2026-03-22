import { NotFoundError, ValidationError } from '@identity-starter/core';
import type { Database } from '@identity-starter/db';
import {
  roles,
  sessionColumns,
  sessions,
  userColumns,
  userRoles,
  users,
} from '@identity-starter/db';
import type { SQL } from 'drizzle-orm';
import { and, count, eq, ilike } from 'drizzle-orm';
import { createDomainEvent, type EventBus } from '../../infra/event-bus.js';
import { ADMIN_EVENTS } from './admin.events.js';
import type { UpdateUserStatusInput, UserListQuery } from './admin.schemas.js';

interface SessionListQuery {
  page: number;
  limit: number;
  userId?: string;
}

export async function listUsers(db: Database, query: UserListQuery) {
  const conditions: SQL[] = [];
  if (query.status) {
    conditions.push(eq(users.status, query.status));
  }
  if (query.email) {
    conditions.push(ilike(users.email, `%${query.email}%`));
  }

  const where = conditions.length > 0 ? and(...conditions) : undefined;

  const [{ total }] = await db.select({ total: count() }).from(users).where(where);

  const offset = (query.page - 1) * query.limit;
  const data = await db
    .select(userColumns)
    .from(users)
    .where(where)
    .limit(query.limit)
    .offset(offset);

  return { data, total, page: query.page, limit: query.limit };
}

export async function getUser(db: Database, userId: string) {
  const [user] = await db.select(userColumns).from(users).where(eq(users.id, userId)).limit(1);

  if (!user) {
    throw new NotFoundError('User', userId);
  }

  const userRoleRows = await db
    .select({ id: roles.id, name: roles.name })
    .from(userRoles)
    .innerJoin(roles, eq(userRoles.roleId, roles.id))
    .where(eq(userRoles.userId, userId));

  return { ...user, roles: userRoleRows };
}

export async function updateUserStatus(
  db: Database,
  eventBus: EventBus,
  userId: string,
  input: UpdateUserStatusInput,
  adminId: string,
) {
  if (userId === adminId) {
    throw new ValidationError('Cannot change own status');
  }

  const [existing] = await db
    .select({ id: users.id })
    .from(users)
    .where(eq(users.id, userId))
    .limit(1);

  if (!existing) {
    throw new NotFoundError('User', userId);
  }

  await db.update(users).set({ status: input.status }).where(eq(users.id, userId));

  const eventName =
    input.status === 'suspended' ? ADMIN_EVENTS.USER_SUSPENDED : ADMIN_EVENTS.USER_ACTIVATED;
  await eventBus.publish(createDomainEvent(eventName, { userId, adminId }));

  if (input.status === 'suspended') {
    await db.delete(sessions).where(eq(sessions.userId, userId));
  }

  return getUser(db, userId);
}

export async function listSessions(db: Database, query: SessionListQuery) {
  const conditions: SQL[] = [];
  if (query.userId) {
    conditions.push(eq(sessions.userId, query.userId));
  }

  const where = conditions.length > 0 ? and(...conditions) : undefined;

  const [{ total }] = await db.select({ total: count() }).from(sessions).where(where);

  const offset = (query.page - 1) * query.limit;
  const data = await db
    .select(sessionColumns)
    .from(sessions)
    .where(where)
    .limit(query.limit)
    .offset(offset);

  return { data, total, page: query.page, limit: query.limit };
}

export async function revokeSession(
  db: Database,
  eventBus: EventBus,
  sessionId: string,
  adminId: string,
) {
  const [session] = await db
    .select({ id: sessions.id, userId: sessions.userId })
    .from(sessions)
    .where(eq(sessions.id, sessionId))
    .limit(1);

  if (!session) {
    throw new NotFoundError('Session', sessionId);
  }

  await db.delete(sessions).where(eq(sessions.id, sessionId));

  await eventBus.publish(
    createDomainEvent(ADMIN_EVENTS.SESSION_REVOKED, {
      sessionId,
      userId: session.userId,
      adminId,
    }),
  );
}

export async function bulkRevokeSessions(
  db: Database,
  eventBus: EventBus,
  userId: string,
  adminId: string,
) {
  const [existing] = await db
    .select({ id: users.id })
    .from(users)
    .where(eq(users.id, userId))
    .limit(1);

  if (!existing) {
    throw new NotFoundError('User', userId);
  }

  const [{ total }] = await db
    .select({ total: count() })
    .from(sessions)
    .where(eq(sessions.userId, userId));

  await db.delete(sessions).where(eq(sessions.userId, userId));

  await eventBus.publish(
    createDomainEvent(ADMIN_EVENTS.SESSIONS_BULK_REVOKED, {
      userId,
      count: total,
      adminId,
    }),
  );

  return { revoked: total };
}
