import crypto from 'node:crypto';
import { ConflictError, TooManyRequestsError, UnauthorizedError } from '@identity-starter/core';
import type { Database } from '@identity-starter/db';
import { mfaChallenges, userColumns, users } from '@identity-starter/db';
import { eq } from 'drizzle-orm';
import { isUniqueViolation } from '../../core/db-utils.js';
import { hashPassword, verifyPassword } from '../../core/password.js';
import { createDomainEvent, type EventBus } from '../../infra/event-bus.js';
import { checkMfaEnrolled } from '../mfa/mfa.service.js';
import { createSession, revokeAllUserSessions, revokeSession } from '../session/session.service.js';
import { AUTH_EVENTS } from './auth.events.js';
import type {
  AuthResponse,
  ChangePasswordInput,
  LoginInput,
  MfaChallengeResponse,
  RegisterInput,
} from './auth.schemas.js';
import { generateVerificationToken } from './email-verification.service.js';
import { calculateDelay, getRecentFailureCount, recordAttempt } from './login-attempts.service.js';

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

export interface RegisterResult extends AuthResponse {
  verificationToken: string;
}

export async function register(
  db: Database,
  eventBus: EventBus,
  input: RegisterInput,
): Promise<RegisterResult> {
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

  const verificationToken = await generateVerificationToken(db, userRow.id);

  await eventBus.publish(createDomainEvent(AUTH_EVENTS.REGISTERED, { userId: userRow.id }));

  return { ...toAuthResponse(userRow, session.token), verificationToken };
}

const MFA_CHALLENGE_TTL_MS = 5 * 60 * 1000;

export async function login(
  db: Database,
  eventBus: EventBus,
  input: LoginInput,
  meta: { ipAddress?: string; userAgent?: string },
): Promise<AuthResponse | MfaChallengeResponse> {
  const ipAddress = meta.ipAddress ?? '0.0.0.0';
  const failureCount = await getRecentFailureCount(db, input.email);
  const delaySec = calculateDelay(failureCount);
  if (delaySec > 0) {
    throw new TooManyRequestsError(delaySec);
  }

  const [row] = await db.select().from(users).where(eq(users.email, input.email)).limit(1);

  if (!row || !row.passwordHash) {
    await recordAttempt(db, { email: input.email, ipAddress, success: false });
    await eventBus.publish(
      createDomainEvent(AUTH_EVENTS.FAILED_LOGIN, {
        email: input.email,
        reason: 'invalid_credentials',
      }),
    );
    throw new UnauthorizedError('Invalid email or password');
  }

  if (row.status === 'suspended') {
    await recordAttempt(db, { email: input.email, ipAddress, success: false });
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
    await recordAttempt(db, { email: input.email, ipAddress, success: false });
    await eventBus.publish(
      createDomainEvent(AUTH_EVENTS.FAILED_LOGIN, {
        email: input.email,
        reason: 'invalid_credentials',
      }),
    );
    throw new UnauthorizedError('Invalid email or password');
  }

  await recordAttempt(db, { email: input.email, ipAddress, success: true });

  const hasMfa = await checkMfaEnrolled(db, row.id);
  if (hasMfa) {
    const mfaToken = crypto.randomBytes(32).toString('base64url');
    await db.insert(mfaChallenges).values({
      userId: row.id,
      token: mfaToken,
      expiresAt: new Date(Date.now() + MFA_CHALLENGE_TTL_MS),
    });

    await eventBus.publish(createDomainEvent(AUTH_EVENTS.LOGIN, { userId: row.id }));

    return { mfaRequired: true, mfaToken };
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

export interface AuthServiceDeps {
  db: Database;
  eventBus: EventBus;
}

export function createAuthService(deps: AuthServiceDeps) {
  const { db, eventBus } = deps;
  return {
    register: (input: RegisterInput) => register(db, eventBus, input),
    login: (input: LoginInput, meta: { ipAddress?: string; userAgent?: string }) =>
      login(db, eventBus, input, meta),
    logout: (sessionId: string, userId: string) => logout(db, eventBus, sessionId, userId),
    changePassword: (userId: string, currentSessionId: string, input: ChangePasswordInput) =>
      changePassword(db, eventBus, userId, currentSessionId, input),
  };
}

export type AuthService = ReturnType<typeof createAuthService>;
