import { NotFoundError, UnauthorizedError } from '@identity-starter/core';
import type { Database } from '@identity-starter/db';
import { passkeys, userColumns, users, webauthnChallenges } from '@identity-starter/db';
import type {
  AuthenticationResponseJSON,
  AuthenticatorTransportFuture,
  PublicKeyCredentialCreationOptionsJSON,
  PublicKeyCredentialRequestOptionsJSON,
  RegistrationResponseJSON,
  WebAuthnCredential,
} from '@simplewebauthn/server';
import {
  generateAuthenticationOptions,
  generateRegistrationOptions,
  verifyAuthenticationResponse,
  verifyRegistrationResponse,
} from '@simplewebauthn/server';
import { and, eq, gt, lte } from 'drizzle-orm';
import { env } from '../../core/env.js';
import { createDomainEvent, type EventBus } from '../../infra/event-bus.js';
import { createSession } from '../session/session.service.js';
import { PASSKEY_EVENTS } from './passkey.events.js';
import type { PasskeyAuthResponse } from './passkey.schemas.js';

const CHALLENGE_TTL_MS = 5 * 60 * 1000;

type SafeUserRow = typeof userColumns;
type SafeUserResult = { [K in keyof SafeUserRow]: SafeUserRow[K]['_']['data'] };

function toAuthResponse(row: SafeUserResult, token: string): PasskeyAuthResponse {
  return {
    token,
    user: {
      id: row.id,
      email: row.email,
      displayName: row.displayName,
      status: row.status as PasskeyAuthResponse['user']['status'],
    },
  };
}

export async function generatePasskeyRegistrationOptions(
  db: Database,
  userId: string,
): Promise<PublicKeyCredentialCreationOptionsJSON> {
  const [user] = await db
    .select({ id: users.id, email: users.email, displayName: users.displayName })
    .from(users)
    .where(eq(users.id, userId))
    .limit(1);

  if (!user) {
    throw new NotFoundError('User', userId);
  }

  const existingPasskeys = await db
    .select({ credentialId: passkeys.credentialId, transports: passkeys.transports })
    .from(passkeys)
    .where(eq(passkeys.userId, userId));

  const options = await generateRegistrationOptions({
    rpName: env.WEBAUTHN_RP_NAME,
    rpID: env.WEBAUTHN_RP_ID,
    userName: user.email,
    attestationType: 'none',
    excludeCredentials: existingPasskeys.map((p) => ({
      id: p.credentialId,
      transports: (p.transports ?? undefined) as AuthenticatorTransportFuture[] | undefined,
    })),
    authenticatorSelection: {
      residentKey: 'preferred',
      userVerification: 'required',
    },
  });

  await db.insert(webauthnChallenges).values({
    userId,
    challenge: options.challenge,
    type: 'registration',
    expiresAt: new Date(Date.now() + CHALLENGE_TTL_MS),
  });

  return options;
}

export async function verifyPasskeyRegistration(
  db: Database,
  eventBus: EventBus,
  userId: string,
  body: RegistrationResponseJSON,
): Promise<{ passkeyId: string }> {
  const [challenge] = await db
    .select()
    .from(webauthnChallenges)
    .where(
      and(
        eq(webauthnChallenges.userId, userId),
        eq(webauthnChallenges.type, 'registration'),
        gt(webauthnChallenges.expiresAt, new Date()),
      ),
    )
    .limit(1);

  if (!challenge) {
    throw new UnauthorizedError('Challenge expired or not found');
  }

  const verification = await verifyRegistrationResponse({
    response: body,
    expectedChallenge: challenge.challenge,
    expectedOrigin: env.WEBAUTHN_ORIGIN,
    expectedRPID: env.WEBAUTHN_RP_ID,
  });

  if (!verification.verified || !verification.registrationInfo) {
    throw new UnauthorizedError('Passkey registration verification failed');
  }

  const { credential, credentialDeviceType, credentialBackedUp } = verification.registrationInfo;

  const [row] = await db
    .insert(passkeys)
    .values({
      userId,
      credentialId: credential.id,
      publicKey: credential.publicKey,
      counter: credential.counter,
      deviceType: credentialDeviceType,
      backedUp: credentialBackedUp,
      transports: (credential.transports as string[] | undefined) ?? null,
      aaguid: verification.registrationInfo.aaguid,
    })
    .returning({ id: passkeys.id });

  await db.delete(webauthnChallenges).where(eq(webauthnChallenges.id, challenge.id));

  await eventBus.publish(
    createDomainEvent(PASSKEY_EVENTS.REGISTERED, { passkeyId: row.id, userId }),
  );

  return { passkeyId: row.id };
}

export async function generatePasskeyAuthenticationOptions(
  db: Database,
): Promise<PublicKeyCredentialRequestOptionsJSON> {
  const options = await generateAuthenticationOptions({
    rpID: env.WEBAUTHN_RP_ID,
    userVerification: 'required',
  });

  await db.insert(webauthnChallenges).values({
    challenge: options.challenge,
    type: 'authentication',
    expiresAt: new Date(Date.now() + CHALLENGE_TTL_MS),
  });

  return options;
}

export async function verifyPasskeyAuthentication(
  db: Database,
  eventBus: EventBus,
  body: AuthenticationResponseJSON,
  meta: { ipAddress?: string; userAgent?: string },
): Promise<PasskeyAuthResponse> {
  const [passkeyRow] = await db
    .select()
    .from(passkeys)
    .where(eq(passkeys.credentialId, body.id))
    .limit(1);

  if (!passkeyRow) {
    throw new UnauthorizedError('Passkey not found');
  }

  const credential: WebAuthnCredential = {
    id: passkeyRow.credentialId,
    publicKey: new Uint8Array(passkeyRow.publicKey),
    counter: passkeyRow.counter,
    transports: (passkeyRow.transports ?? undefined) as AuthenticatorTransportFuture[] | undefined,
  };

  const verification = await verifyAuthenticationResponse({
    response: body,
    expectedChallenge: async (challenge: string) => {
      const [row] = await db
        .select()
        .from(webauthnChallenges)
        .where(
          and(
            eq(webauthnChallenges.challenge, challenge),
            eq(webauthnChallenges.type, 'authentication'),
            gt(webauthnChallenges.expiresAt, new Date()),
          ),
        )
        .limit(1);

      if (row) {
        await db.delete(webauthnChallenges).where(eq(webauthnChallenges.id, row.id));
        return true;
      }
      return false;
    },
    expectedOrigin: env.WEBAUTHN_ORIGIN,
    expectedRPID: env.WEBAUTHN_RP_ID,
    credential,
  });

  if (!verification.verified) {
    throw new UnauthorizedError('Passkey authentication failed');
  }

  const { newCounter } = verification.authenticationInfo;
  await db.update(passkeys).set({ counter: newCounter }).where(eq(passkeys.id, passkeyRow.id));

  const session = await createSession(db, eventBus, {
    userId: passkeyRow.userId,
    ipAddress: meta.ipAddress,
    userAgent: meta.userAgent,
  });

  const [userRow] = await db
    .select(userColumns)
    .from(users)
    .where(eq(users.id, passkeyRow.userId))
    .limit(1);

  if (!userRow) {
    throw new NotFoundError('User', passkeyRow.userId);
  }

  return toAuthResponse(userRow, session.token);
}

export async function deleteExpiredChallenges(db: Database): Promise<number> {
  const deleted = await db
    .delete(webauthnChallenges)
    .where(lte(webauthnChallenges.expiresAt, new Date()))
    .returning({ id: webauthnChallenges.id });

  return deleted.length;
}

export interface PasskeyServiceDeps {
  db: Database;
  eventBus: EventBus;
}

export function createPasskeyService(deps: PasskeyServiceDeps) {
  const { db, eventBus } = deps;
  return {
    generateRegistrationOptions: (userId: string) => generatePasskeyRegistrationOptions(db, userId),
    verifyRegistration: (userId: string, body: RegistrationResponseJSON) =>
      verifyPasskeyRegistration(db, eventBus, userId, body),
    generateAuthenticationOptions: () => generatePasskeyAuthenticationOptions(db),
    verifyAuthentication: (
      body: AuthenticationResponseJSON,
      meta: { ipAddress?: string; userAgent?: string },
    ) => verifyPasskeyAuthentication(db, eventBus, body, meta),
    deleteExpiredChallenges: () => deleteExpiredChallenges(db),
  };
}

export type PasskeyService = ReturnType<typeof createPasskeyService>;
