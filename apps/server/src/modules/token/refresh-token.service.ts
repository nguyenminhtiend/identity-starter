import { createHash, randomBytes } from 'node:crypto';

import { UnauthorizedError } from '@identity-starter/core';
import type { Database } from '@identity-starter/db';
import { refreshTokens } from '@identity-starter/db';
import { and, eq, isNull } from 'drizzle-orm';
import { v7 as uuidv7 } from 'uuid';

import { createDomainEvent, type EventBus } from '../../infra/event-bus.js';
import { TOKEN_EVENTS } from './token.events.js';

export function hashToken(token: string): string {
  return createHash('sha256').update(token).digest('hex');
}

function generateRefreshTokenPlaintext(): string {
  return randomBytes(32).toString('base64url');
}

export interface CreateRefreshTokenParams {
  clientId: string;
  userId: string;
  scope: string;
  expiresInSeconds: number;
  familyId?: string;
  dpopJkt?: string;
}

export interface RefreshTokenServiceDeps {
  db: Database;
  eventBus: EventBus;
}

async function revokeAllNonRevokedInFamily(
  db: Database,
  eventBus: EventBus,
  familyId: string,
): Promise<void> {
  const now = new Date();
  await db
    .update(refreshTokens)
    .set({ revokedAt: now })
    .where(and(eq(refreshTokens.familyId, familyId), isNull(refreshTokens.revokedAt)));

  await eventBus.publish(createDomainEvent(TOKEN_EVENTS.REFRESH_FAMILY_REVOKED, { familyId }));
}

export async function createRefreshToken(
  db: Database,
  eventBus: EventBus,
  params: CreateRefreshTokenParams,
): Promise<{ plaintext: string; familyId: string }> {
  const plaintext = generateRefreshTokenPlaintext();
  const tokenHash = hashToken(plaintext);
  const familyId = params.familyId ?? uuidv7();
  const expiresAt = new Date(Date.now() + params.expiresInSeconds * 1000);

  await db.insert(refreshTokens).values({
    token: tokenHash,
    clientId: params.clientId,
    userId: params.userId,
    scope: params.scope,
    expiresAt,
    familyId,
    dpopJkt: params.dpopJkt ?? null,
  });

  await eventBus.publish(
    createDomainEvent(TOKEN_EVENTS.REFRESH_ISSUED, {
      clientId: params.clientId,
      userId: params.userId,
      familyId,
    }),
  );

  return { plaintext, familyId };
}

export async function rotateRefreshToken(
  db: Database,
  eventBus: EventBus,
  token: string,
  gracePeriodSeconds: number,
  dpopJkt?: string,
): Promise<string> {
  const incomingHash = hashToken(token);
  const now = new Date();

  const [row] = await db
    .select()
    .from(refreshTokens)
    .where(eq(refreshTokens.token, incomingHash))
    .limit(1);

  if (!row) {
    throw new UnauthorizedError('Invalid refresh token');
  }

  if (row.dpopJkt != null) {
    if (dpopJkt !== row.dpopJkt) {
      throw new UnauthorizedError('DPoP binding mismatch');
    }
  }

  if (row.revokedAt) {
    const graceEndMs = row.revokedAt.getTime() + gracePeriodSeconds * 1000;
    const withinGrace = now.getTime() < graceEndMs;

    if (withinGrace && row.rotationGracePlaintext != null) {
      return row.rotationGracePlaintext;
    }

    if (withinGrace && row.rotationGracePlaintext == null) {
      throw new UnauthorizedError('Invalid refresh token');
    }

    await revokeAllNonRevokedInFamily(db, eventBus, row.familyId);
    throw new UnauthorizedError('Refresh token reuse detected');
  }

  if (row.expiresAt.getTime() <= now.getTime()) {
    throw new UnauthorizedError('Invalid refresh token');
  }

  const newPlain = generateRefreshTokenPlaintext();
  const newHash = hashToken(newPlain);
  const ttlMs = Math.max(row.expiresAt.getTime() - row.createdAt.getTime(), 60_000);
  const newExpiresAt = new Date(now.getTime() + ttlMs);

  await db.transaction(async (tx) => {
    const [current] = await tx
      .select()
      .from(refreshTokens)
      .where(eq(refreshTokens.token, incomingHash))
      .limit(1);

    if (!current || current.revokedAt != null) {
      throw new UnauthorizedError('Invalid refresh token');
    }

    if (current.expiresAt.getTime() <= now.getTime()) {
      throw new UnauthorizedError('Invalid refresh token');
    }

    await tx
      .update(refreshTokens)
      .set({
        revokedAt: now,
        rotationGracePlaintext: newPlain,
      })
      .where(eq(refreshTokens.id, current.id));

    await tx.insert(refreshTokens).values({
      token: newHash,
      clientId: current.clientId,
      userId: current.userId,
      scope: current.scope,
      expiresAt: newExpiresAt,
      familyId: current.familyId,
      dpopJkt: current.dpopJkt ?? null,
    });
  });

  await eventBus.publish(
    createDomainEvent(TOKEN_EVENTS.REFRESH_REVOKED, {
      familyId: row.familyId,
      clientId: row.clientId,
      userId: row.userId,
    }),
  );

  await eventBus.publish(
    createDomainEvent(TOKEN_EVENTS.REFRESH_ISSUED, {
      familyId: row.familyId,
      clientId: row.clientId,
      userId: row.userId,
    }),
  );

  return newPlain;
}

export async function revokeRefreshToken(
  db: Database,
  eventBus: EventBus,
  token: string,
): Promise<void> {
  const tokenHash = hashToken(token);
  const now = new Date();

  const [updated] = await db
    .update(refreshTokens)
    .set({ revokedAt: now })
    .where(and(eq(refreshTokens.token, tokenHash), isNull(refreshTokens.revokedAt)))
    .returning({
      id: refreshTokens.id,
      familyId: refreshTokens.familyId,
      clientId: refreshTokens.clientId,
      userId: refreshTokens.userId,
    });

  if (!updated) {
    throw new UnauthorizedError('Invalid refresh token');
  }

  await eventBus.publish(
    createDomainEvent(TOKEN_EVENTS.REFRESH_REVOKED, {
      familyId: updated.familyId,
      clientId: updated.clientId,
      userId: updated.userId,
    }),
  );
}

export async function revokeAllForClient(
  db: Database,
  eventBus: EventBus,
  clientId: string,
  userId: string,
): Promise<void> {
  const now = new Date();
  await db
    .update(refreshTokens)
    .set({ revokedAt: now })
    .where(
      and(
        eq(refreshTokens.clientId, clientId),
        eq(refreshTokens.userId, userId),
        isNull(refreshTokens.revokedAt),
      ),
    );

  await eventBus.publish(createDomainEvent(TOKEN_EVENTS.REFRESH_REVOKED, { clientId, userId }));
}

export function createRefreshTokenService(deps: RefreshTokenServiceDeps) {
  const { db, eventBus } = deps;
  return {
    createRefreshToken: (params: CreateRefreshTokenParams) =>
      createRefreshToken(db, eventBus, params),
    rotateRefreshToken: (token: string, gracePeriodSeconds: number, dpopJkt?: string) =>
      rotateRefreshToken(db, eventBus, token, gracePeriodSeconds, dpopJkt),
    revokeRefreshToken: (token: string) => revokeRefreshToken(db, eventBus, token),
    revokeAllForClient: (clientId: string, userId: string) =>
      revokeAllForClient(db, eventBus, clientId, userId),
  };
}

export type RefreshTokenService = ReturnType<typeof createRefreshTokenService>;
