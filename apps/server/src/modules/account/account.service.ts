import { NotFoundError, ValidationError } from '@identity-starter/core';
import type { Database } from '@identity-starter/db';
import { passkeyColumns, passkeys, sessionColumns, sessions, users } from '@identity-starter/db';
import { and, eq, gt } from 'drizzle-orm';
import { createDomainEvent, type EventBus } from '../../infra/event-bus.js';
import { ACCOUNT_EVENTS } from './account.events.js';
import type { PasskeyListItem, ProfileResponse, UpdateProfileInput } from './account.schemas.js';

const profileSelection = {
  id: users.id,
  email: users.email,
  emailVerified: users.emailVerified,
  displayName: users.displayName,
  status: users.status,
  metadata: users.metadata,
  createdAt: users.createdAt,
} as const;

type ProfileRow = {
  [K in keyof typeof profileSelection]: (typeof profileSelection)[K]['_']['data'];
};

function mapToProfile(row: ProfileRow): ProfileResponse {
  return {
    id: row.id,
    email: row.email,
    emailVerified: row.emailVerified,
    displayName: row.displayName,
    status: row.status as ProfileResponse['status'],
    metadata: row.metadata as Record<string, unknown>,
    createdAt: row.createdAt,
  };
}

function mapToPasskeyListItem(row: {
  id: string;
  credentialId: string;
  deviceType: string;
  backedUp: boolean;
  name: string | null;
  aaguid: string | null;
  createdAt: Date;
}): PasskeyListItem {
  return {
    id: row.id,
    credentialId: row.credentialId,
    deviceType: row.deviceType,
    backedUp: row.backedUp,
    name: row.name,
    aaguid: row.aaguid,
    createdAt: row.createdAt,
  };
}

export async function getProfile(db: Database, userId: string): Promise<ProfileResponse> {
  const [row] = await db.select(profileSelection).from(users).where(eq(users.id, userId)).limit(1);

  if (!row) {
    throw new NotFoundError('User', userId);
  }

  return mapToProfile(row);
}

export async function updateProfile(
  db: Database,
  eventBus: EventBus,
  userId: string,
  input: UpdateProfileInput,
): Promise<ProfileResponse> {
  const patch: Partial<{ displayName: string; metadata: Record<string, unknown> }> = {};
  if (input.displayName !== undefined) {
    patch.displayName = input.displayName;
  }
  if (input.metadata !== undefined) {
    patch.metadata = input.metadata;
  }

  if (Object.keys(patch).length > 0) {
    await db.update(users).set(patch).where(eq(users.id, userId));
    await eventBus.publish(createDomainEvent(ACCOUNT_EVENTS.PROFILE_UPDATED, { userId }));
  }

  return getProfile(db, userId);
}

export async function listSessions(
  db: Database,
  userId: string,
  currentSessionId: string,
): Promise<
  Array<{
    id: string;
    ipAddress: string | null;
    userAgent: string | null;
    lastActiveAt: Date;
    createdAt: Date;
    isCurrent: boolean;
  }>
> {
  const rows = await db
    .select(sessionColumns)
    .from(sessions)
    .where(and(eq(sessions.userId, userId), gt(sessions.expiresAt, new Date())));

  return rows.map((row) => ({
    id: row.id,
    ipAddress: row.ipAddress,
    userAgent: row.userAgent,
    lastActiveAt: row.lastActiveAt,
    createdAt: row.createdAt,
    isCurrent: row.id === currentSessionId,
  }));
}

export async function revokeOwnSession(
  db: Database,
  eventBus: EventBus,
  userId: string,
  sessionId: string,
  currentSessionId: string,
): Promise<void> {
  if (sessionId === currentSessionId) {
    throw new ValidationError('Cannot revoke current session');
  }

  const [row] = await db
    .select({ id: sessions.id })
    .from(sessions)
    .where(and(eq(sessions.id, sessionId), eq(sessions.userId, userId)))
    .limit(1);

  if (!row) {
    throw new NotFoundError('Session', sessionId);
  }

  await db.delete(sessions).where(eq(sessions.id, sessionId));

  await eventBus.publish(createDomainEvent(ACCOUNT_EVENTS.SESSION_REVOKED, { sessionId, userId }));
}

export async function listPasskeys(db: Database, userId: string): Promise<PasskeyListItem[]> {
  const rows = await db.select(passkeyColumns).from(passkeys).where(eq(passkeys.userId, userId));

  return rows.map((row) => mapToPasskeyListItem(row));
}

export async function renamePasskey(
  db: Database,
  eventBus: EventBus,
  userId: string,
  passkeyId: string,
  name: string,
): Promise<PasskeyListItem> {
  const [existing] = await db
    .select(passkeyColumns)
    .from(passkeys)
    .where(and(eq(passkeys.id, passkeyId), eq(passkeys.userId, userId)))
    .limit(1);

  if (!existing) {
    throw new NotFoundError('Passkey', passkeyId);
  }

  const [updated] = await db
    .update(passkeys)
    .set({ name })
    .where(eq(passkeys.id, passkeyId))
    .returning(passkeyColumns);

  if (!updated) {
    throw new NotFoundError('Passkey', passkeyId);
  }

  await eventBus.publish(createDomainEvent(ACCOUNT_EVENTS.PASSKEY_RENAMED, { passkeyId, userId }));

  return mapToPasskeyListItem(updated);
}

export async function deletePasskey(
  db: Database,
  eventBus: EventBus,
  userId: string,
  passkeyId: string,
): Promise<void> {
  const [owned] = await db
    .select(passkeyColumns)
    .from(passkeys)
    .where(and(eq(passkeys.id, passkeyId), eq(passkeys.userId, userId)))
    .limit(1);

  if (!owned) {
    throw new NotFoundError('Passkey', passkeyId);
  }

  const [userRow] = await db
    .select({ passwordHash: users.passwordHash })
    .from(users)
    .where(eq(users.id, userId))
    .limit(1);

  const userPasskeys = await db
    .select({ id: passkeys.id })
    .from(passkeys)
    .where(eq(passkeys.userId, userId));

  const isLastPasskey = userPasskeys.length === 1;
  const hasNoPassword = userRow?.passwordHash == null;

  if (isLastPasskey && hasNoPassword) {
    throw new ValidationError('Cannot delete last passkey when the account has no password set');
  }

  await db.delete(passkeys).where(eq(passkeys.id, passkeyId));

  await eventBus.publish(createDomainEvent(ACCOUNT_EVENTS.PASSKEY_DELETED, { passkeyId, userId }));
}

export interface AccountServiceDeps {
  db: Database;
  eventBus: EventBus;
}

export function createAccountService(deps: AccountServiceDeps) {
  const { db, eventBus } = deps;
  return {
    getProfile: (userId: string) => getProfile(db, userId),
    updateProfile: (userId: string, input: UpdateProfileInput) =>
      updateProfile(db, eventBus, userId, input),
    listSessions: (userId: string, currentSessionId: string) =>
      listSessions(db, userId, currentSessionId),
    revokeOwnSession: (userId: string, sessionId: string, currentSessionId: string) =>
      revokeOwnSession(db, eventBus, userId, sessionId, currentSessionId),
    listPasskeys: (userId: string) => listPasskeys(db, userId),
    renamePasskey: (userId: string, passkeyId: string, name: string) =>
      renamePasskey(db, eventBus, userId, passkeyId, name),
    deletePasskey: (userId: string, passkeyId: string) =>
      deletePasskey(db, eventBus, userId, passkeyId),
  };
}

export type AccountService = ReturnType<typeof createAccountService>;
