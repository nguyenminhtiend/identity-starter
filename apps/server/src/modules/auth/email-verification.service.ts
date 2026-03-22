import { randomBytes } from 'node:crypto';
import { UnauthorizedError } from '@identity-starter/core';
import type { Database } from '@identity-starter/db';
import { emailVerificationTokens, users } from '@identity-starter/db';
import { and, eq, gt, isNull } from 'drizzle-orm';
import { createDomainEvent, type EventBus } from '../../infra/event-bus.js';
import { AUTH_EVENTS } from './auth.events.js';

const VERIFICATION_TTL_MS = 24 * 60 * 60 * 1000;

export async function generateVerificationToken(db: Database, userId: string): Promise<string> {
  const token = randomBytes(32).toString('base64url');
  const expiresAt = new Date(Date.now() + VERIFICATION_TTL_MS);

  await db.insert(emailVerificationTokens).values({
    userId,
    token,
    expiresAt,
  });

  return token;
}

export async function verifyEmail(db: Database, eventBus: EventBus, token: string): Promise<void> {
  const [record] = await db
    .select()
    .from(emailVerificationTokens)
    .where(eq(emailVerificationTokens.token, token))
    .limit(1);

  if (!record || record.usedAt !== null || record.expiresAt <= new Date()) {
    throw new UnauthorizedError('Invalid or expired verification token');
  }

  let didVerify = false;

  await db.transaction(async (tx) => {
    const [marked] = await tx
      .update(emailVerificationTokens)
      .set({ usedAt: new Date() })
      .where(
        and(
          eq(emailVerificationTokens.id, record.id),
          isNull(emailVerificationTokens.usedAt),
          gt(emailVerificationTokens.expiresAt, new Date()),
        ),
      )
      .returning({ id: emailVerificationTokens.id });

    if (!marked) {
      throw new UnauthorizedError('Invalid or expired verification token');
    }

    const [userRow] = await tx.select().from(users).where(eq(users.id, record.userId)).limit(1);

    if (!userRow) {
      throw new UnauthorizedError('Invalid or expired verification token');
    }

    if (userRow.status === 'pending_verification') {
      await tx
        .update(users)
        .set({
          emailVerified: true,
          status: 'active',
          updatedAt: new Date(),
        })
        .where(eq(users.id, record.userId));
      didVerify = true;
    }
  });

  if (didVerify) {
    await eventBus.publish(
      createDomainEvent(AUTH_EVENTS.EMAIL_VERIFIED, { userId: record.userId }),
    );
  }
}

export async function resendVerification(db: Database, userId: string): Promise<string> {
  await db
    .update(emailVerificationTokens)
    .set({ usedAt: new Date() })
    .where(
      and(
        eq(emailVerificationTokens.userId, userId),
        isNull(emailVerificationTokens.usedAt),
        gt(emailVerificationTokens.expiresAt, new Date()),
      ),
    );

  return generateVerificationToken(db, userId);
}

export interface ResendVerificationForEmailResult {
  message: string;
  verificationToken?: string;
}

export async function resendVerificationForEmail(
  db: Database,
  email: string,
): Promise<ResendVerificationForEmailResult> {
  const genericMessage = 'If your account is eligible, a verification email has been sent.';

  const [user] = await db.select().from(users).where(eq(users.email, email)).limit(1);

  if (!user || user.emailVerified || user.status !== 'pending_verification') {
    return { message: genericMessage };
  }

  const verificationToken = await resendVerification(db, user.id);

  return {
    message: 'Verification email has been sent.',
    verificationToken,
  };
}

export interface EmailVerificationServiceDeps {
  db: Database;
  eventBus: EventBus;
}

export function createEmailVerificationService(deps: EmailVerificationServiceDeps) {
  const { db, eventBus } = deps;
  return {
    verifyEmail: (token: string) => verifyEmail(db, eventBus, token),
    resendVerificationForEmail: (email: string) => resendVerificationForEmail(db, email),
  };
}

export type EmailVerificationService = ReturnType<typeof createEmailVerificationService>;
