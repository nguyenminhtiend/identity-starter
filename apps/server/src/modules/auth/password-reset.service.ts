import { randomBytes } from 'node:crypto';
import { UnauthorizedError } from '@identity-starter/core';
import type { Database } from '@identity-starter/db';
import { passwordResetTokens, users } from '@identity-starter/db';
import { and, count, eq, gte, isNull } from 'drizzle-orm';
import { hashPassword } from '../../core/password.js';
import { createDomainEvent, type EventBus } from '../../infra/event-bus.js';
import { revokeAllUserSessions } from '../session/session.service.js';
import { AUTH_EVENTS } from './auth.events.js';
import type { ResetPasswordInput } from './password-reset.schemas.js';

const RESET_TOKEN_TTL_MS = 60 * 60 * 1000;
const MAX_UNUSED_RESET_REQUESTS_PER_HOUR = 3;

export async function requestPasswordReset(
  db: Database,
  eventBus: EventBus,
  email: string,
): Promise<string | null> {
  const [user] = await db.select().from(users).where(eq(users.email, email)).limit(1);

  if (!user) {
    return null;
  }

  const hourAgo = new Date(Date.now() - 60 * 60 * 1000);

  const [countRow] = await db
    .select({ value: count() })
    .from(passwordResetTokens)
    .where(
      and(
        eq(passwordResetTokens.userId, user.id),
        isNull(passwordResetTokens.usedAt),
        gte(passwordResetTokens.createdAt, hourAgo),
      ),
    );

  const row = countRow as { value?: unknown; count?: unknown } | undefined;
  const recentUnused = Number(row?.value ?? row?.count ?? 0);
  if (recentUnused >= MAX_UNUSED_RESET_REQUESTS_PER_HOUR) {
    return null;
  }

  const token = randomBytes(32).toString('base64url');
  const expiresAt = new Date(Date.now() + RESET_TOKEN_TTL_MS);

  await db.insert(passwordResetTokens).values({
    userId: user.id,
    token,
    expiresAt,
  });

  await eventBus.publish(
    createDomainEvent(AUTH_EVENTS.PASSWORD_RESET_REQUESTED, {
      userId: user.id,
      email: user.email,
      token,
    }),
  );

  return token;
}

export async function resetPassword(
  db: Database,
  eventBus: EventBus,
  input: ResetPasswordInput,
): Promise<void> {
  const [record] = await db
    .select()
    .from(passwordResetTokens)
    .where(eq(passwordResetTokens.token, input.token))
    .limit(1);

  if (!record || record.usedAt !== null || record.expiresAt <= new Date()) {
    throw new UnauthorizedError('Invalid or expired reset token');
  }

  const newHash = await hashPassword(input.newPassword);

  await db
    .update(users)
    .set({ passwordHash: newHash, updatedAt: new Date() })
    .where(eq(users.id, record.userId));

  await revokeAllUserSessions(db, eventBus, record.userId);

  await db
    .update(passwordResetTokens)
    .set({ usedAt: new Date() })
    .where(eq(passwordResetTokens.id, record.id));

  await eventBus.publish(
    createDomainEvent(AUTH_EVENTS.PASSWORD_RESET_COMPLETED, { userId: record.userId }),
  );
}

export interface PasswordResetServiceDeps {
  db: Database;
  eventBus: EventBus;
}

export function createPasswordResetService(deps: PasswordResetServiceDeps) {
  const { db, eventBus } = deps;
  return {
    requestReset: (email: string) => requestPasswordReset(db, eventBus, email),
    reset: (input: ResetPasswordInput) => resetPassword(db, eventBus, input),
  };
}

export type PasswordResetService = ReturnType<typeof createPasswordResetService>;
