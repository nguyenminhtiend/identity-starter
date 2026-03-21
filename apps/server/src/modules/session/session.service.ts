import crypto from 'node:crypto';
import type { Database } from '@identity-starter/db';
import { sessionColumns, sessions } from '@identity-starter/db';
import { and, eq, gt, lte, ne } from 'drizzle-orm';
import { env } from '../../core/env.js';
import { createDomainEvent, type EventBus } from '../../infra/event-bus.js';
import { SESSION_EVENTS } from './session.events.js';
import type { CreateSessionInput, Session } from './session.schemas.js';

type SessionRow = typeof sessions.$inferSelect;

const LAST_ACTIVE_DEBOUNCE_MS = 5 * 60 * 1000; // 5 minutes

function hashToken(token: string): string {
  return crypto.createHash('sha256').update(token).digest('base64url');
}

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
  const rawToken = crypto.randomBytes(32).toString('base64url');
  const tokenHash = hashToken(rawToken);
  const expiresAt = new Date(Date.now() + env.SESSION_TTL_SECONDS * 1000);

  const [row] = await db
    .insert(sessions)
    .values({
      token: tokenHash,
      userId: input.userId,
      expiresAt,
      ipAddress: input.ipAddress ?? null,
      userAgent: input.userAgent ?? null,
    })
    .returning(sessionColumns);

  const session = mapToSession(row);
  await eventBus.publish(createDomainEvent(SESSION_EVENTS.CREATED, { session }));
  return { ...session, token: rawToken };
}

export async function validateSession(db: Database, token: string): Promise<Session | null> {
  const tokenHash = hashToken(token);
  const [row] = await db
    .select(sessionColumns)
    .from(sessions)
    .where(and(eq(sessions.token, tokenHash), gt(sessions.expiresAt, new Date())))
    .limit(1);

  if (!row) {
    return null;
  }

  const now = new Date();
  const msSinceLastActive = now.getTime() - row.lastActiveAt.getTime();
  if (msSinceLastActive > LAST_ACTIVE_DEBOUNCE_MS) {
    await db.update(sessions).set({ lastActiveAt: now }).where(eq(sessions.id, row.id));
    return mapToSession({ ...row, lastActiveAt: now });
  }

  return mapToSession(row);
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
  excludeSessionId?: string,
): Promise<void> {
  const condition = excludeSessionId
    ? and(eq(sessions.userId, userId), ne(sessions.id, excludeSessionId))
    : eq(sessions.userId, userId);

  const rows = await db.select({ id: sessions.id }).from(sessions).where(condition);

  if (rows.length === 0) {
    return;
  }

  await db.delete(sessions).where(condition);

  await Promise.all(
    rows.map((row) =>
      eventBus.publish(createDomainEvent(SESSION_EVENTS.REVOKED, { sessionId: row.id, userId })),
    ),
  );
}

export async function deleteExpiredSessions(db: Database): Promise<number> {
  const deleted = await db
    .delete(sessions)
    .where(lte(sessions.expiresAt, new Date()))
    .returning({ id: sessions.id });

  return deleted.length;
}
