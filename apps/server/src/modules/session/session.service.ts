import crypto from 'node:crypto';
import type { Database } from '@identity-starter/db';
import { sessionColumns, sessions } from '@identity-starter/db';
import { and, eq, gt, lte } from 'drizzle-orm';
import { env } from '../../core/env.js';
import { createDomainEvent, type EventBus } from '../../infra/event-bus.js';
import { SESSION_EVENTS } from './session.events.js';
import type { CreateSessionInput, Session } from './session.schemas.js';

type SessionRow = typeof sessions.$inferSelect;

function mapToSession(row: SessionRow): Session {
  return {
    id: row.id,
    token: row.token,
    userId: row.userId,
    expiresAt: row.expiresAt,
    lastActiveAt: row.lastActiveAt,
    ipAddress: row.ipAddress,
    userAgent: row.userAgent,
    createdAt: row.createdAt,
  };
}

export async function createSession(
  db: Database,
  eventBus: EventBus,
  input: CreateSessionInput,
): Promise<Session> {
  const token = crypto.randomBytes(32).toString('base64url');
  const expiresAt = new Date(Date.now() + env.SESSION_TTL_SECONDS * 1000);

  const [row] = await db
    .insert(sessions)
    .values({
      token,
      userId: input.userId,
      expiresAt,
      ipAddress: input.ipAddress ?? null,
      userAgent: input.userAgent ?? null,
    })
    .returning(sessionColumns);

  const session = mapToSession(row);
  await eventBus.publish(createDomainEvent(SESSION_EVENTS.CREATED, { session }));
  return session;
}

export async function validateSession(db: Database, token: string): Promise<Session | null> {
  const [row] = await db
    .select(sessionColumns)
    .from(sessions)
    .where(and(eq(sessions.token, token), gt(sessions.expiresAt, new Date())))
    .limit(1);

  if (!row) {
    return null;
  }

  const now = new Date();
  await db.update(sessions).set({ lastActiveAt: now }).where(eq(sessions.id, row.id));

  return mapToSession({ ...row, lastActiveAt: now });
}

export async function revokeSession(db: Database, eventBus: EventBus, id: string): Promise<void> {
  const [row] = await db
    .select({ userId: sessions.userId })
    .from(sessions)
    .where(eq(sessions.id, id))
    .limit(1);

  if (!row) {
    return;
  }

  await db.delete(sessions).where(eq(sessions.id, id));

  await eventBus.publish(
    createDomainEvent(SESSION_EVENTS.REVOKED, { sessionId: id, userId: row.userId }),
  );
}

export async function revokeAllUserSessions(
  db: Database,
  eventBus: EventBus,
  userId: string,
): Promise<void> {
  const rows = await db
    .select({ id: sessions.id })
    .from(sessions)
    .where(eq(sessions.userId, userId));

  if (rows.length === 0) {
    return;
  }

  await db.delete(sessions).where(eq(sessions.userId, userId));

  for (const row of rows) {
    await eventBus.publish(
      createDomainEvent(SESSION_EVENTS.REVOKED, { sessionId: row.id, userId }),
    );
  }
}

export async function deleteExpiredSessions(db: Database): Promise<number> {
  const deleted = await db
    .delete(sessions)
    .where(lte(sessions.expiresAt, new Date()))
    .returning({ id: sessions.id });

  return deleted.length;
}
