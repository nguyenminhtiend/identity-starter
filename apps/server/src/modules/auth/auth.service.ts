import { ConflictError, UnauthorizedError } from '@identity-starter/core';
import type { Database } from '@identity-starter/db';
import { userColumns, users } from '@identity-starter/db';
import { eq } from 'drizzle-orm';
import { hashPassword, verifyPassword } from '../../core/password.js';
import { createDomainEvent, type EventBus } from '../../infra/event-bus.js';
import { createSession, revokeAllUserSessions, revokeSession } from '../session/session.service.js';
import { AUTH_EVENTS } from './auth.events.js';
import type {
  AuthResponse,
  ChangePasswordInput,
  LoginInput,
  RegisterInput,
} from './auth.schemas.js';

type SafeRow = typeof userColumns;
type SafeRowResult = { [K in keyof SafeRow]: SafeRow[K]['_']['data'] };

function toAuthResponse(row: SafeRowResult, token: string): AuthResponse {
  return {
    token,
    user: {
      id: row.id,
      email: row.email,
      displayName: row.displayName,
      status: row.status as AuthResponse['user']['status'],
    },
  };
}

function isUniqueViolation(error: unknown): boolean {
  if (!(error instanceof Error)) {
    return false;
  }
  const pgCode = (error as { code?: string }).code;
  if (pgCode === '23505') {
    return true;
  }
  const cause = (error as { cause?: { code?: string } }).cause;
  return cause?.code === '23505';
}

export async function register(
  db: Database,
  eventBus: EventBus,
  input: RegisterInput,
): Promise<AuthResponse> {
  const passwordHash = await hashPassword(input.password);

  let userRow: SafeRowResult;
  try {
    [userRow] = await db
      .insert(users)
      .values({
        email: input.email,
        displayName: input.displayName,
        passwordHash,
      })
      .returning(userColumns);
  } catch (error) {
    if (isUniqueViolation(error)) {
      throw new ConflictError('User', 'email', input.email);
    }
    throw error;
  }

  const session = await createSession(db, eventBus, { userId: userRow.id });

  await eventBus.publish(createDomainEvent(AUTH_EVENTS.REGISTERED, { userId: userRow.id }));

  return toAuthResponse(userRow, session.token);
}

export async function login(
  db: Database,
  eventBus: EventBus,
  input: LoginInput,
  meta: { ipAddress?: string; userAgent?: string },
): Promise<AuthResponse> {
  const [row] = await db.select().from(users).where(eq(users.email, input.email)).limit(1);

  if (!row || !row.passwordHash) {
    await eventBus.publish(
      createDomainEvent(AUTH_EVENTS.FAILED_LOGIN, {
        email: input.email,
        reason: 'invalid_credentials',
      }),
    );
    throw new UnauthorizedError('Invalid email or password');
  }

  if (row.status === 'suspended') {
    await eventBus.publish(
      createDomainEvent(AUTH_EVENTS.FAILED_LOGIN, {
        email: input.email,
        reason: 'account_suspended',
      }),
    );
    throw new UnauthorizedError('Account is suspended');
  }

  const valid = await verifyPassword(row.passwordHash, input.password);
  if (!valid) {
    await eventBus.publish(
      createDomainEvent(AUTH_EVENTS.FAILED_LOGIN, {
        email: input.email,
        reason: 'invalid_credentials',
      }),
    );
    throw new UnauthorizedError('Invalid email or password');
  }

  const session = await createSession(db, eventBus, {
    userId: row.id,
    ipAddress: meta.ipAddress,
    userAgent: meta.userAgent,
  });

  const { passwordHash: _, ...safeRow } = row;

  await eventBus.publish(createDomainEvent(AUTH_EVENTS.LOGIN, { userId: row.id }));

  return toAuthResponse(safeRow, session.token);
}

export async function logout(
  db: Database,
  eventBus: EventBus,
  sessionId: string,
  userId: string,
): Promise<void> {
  await revokeSession(db, eventBus, sessionId);
  await eventBus.publish(createDomainEvent(AUTH_EVENTS.LOGOUT, { userId, sessionId }));
}

export async function changePassword(
  db: Database,
  eventBus: EventBus,
  userId: string,
  currentSessionId: string,
  input: ChangePasswordInput,
): Promise<void> {
  const [row] = await db.select().from(users).where(eq(users.id, userId)).limit(1);

  if (!row || !row.passwordHash) {
    throw new UnauthorizedError('Cannot change password');
  }

  const valid = await verifyPassword(row.passwordHash, input.currentPassword);
  if (!valid) {
    throw new UnauthorizedError('Current password is incorrect');
  }

  const newHash = await hashPassword(input.newPassword);
  await db
    .update(users)
    .set({ passwordHash: newHash, updatedAt: new Date() })
    .where(eq(users.id, userId));

  await revokeAllUserSessions(db, eventBus, userId, currentSessionId);

  await eventBus.publish(createDomainEvent(AUTH_EVENTS.PASSWORD_CHANGED, { userId }));
}
