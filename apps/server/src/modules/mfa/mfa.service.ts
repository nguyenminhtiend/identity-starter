import crypto from 'node:crypto';
import {
  ConflictError,
  NotFoundError,
  UnauthorizedError,
  ValidationError,
} from '@identity-starter/core';
import type { Database } from '@identity-starter/db';
import {
  mfaChallenges,
  recoveryCodes,
  totpSecrets,
  userColumns,
  users,
} from '@identity-starter/db';
import { and, count, eq, gt, isNull } from 'drizzle-orm';
import * as OTPAuth from 'otpauth';
import { decrypt, encrypt } from '../../core/crypto.js';
import { env } from '../../core/env.js';
import { hashPassword, verifyPassword } from '../../core/password.js';
import { createDomainEvent, type EventBus } from '../../infra/event-bus.js';
import { createSession } from '../session/session.service.js';
import { MFA_EVENTS } from './mfa.events.js';
import type { MfaVerifyInput, MfaVerifyResponse } from './mfa.schemas.js';

export function generateRecoveryCodesRaw(): string[] {
  const codes: string[] = [];
  const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  for (let i = 0; i < 8; i++) {
    const bytes = crypto.randomBytes(8);
    let code = '';
    for (let j = 0; j < 8; j++) {
      code += chars[bytes[j] % chars.length];
      if (j === 3) {
        code += '-';
      }
    }
    codes.push(code);
  }
  return codes;
}

function requireTotpKey(): string {
  const key = env.TOTP_ENCRYPTION_KEY;
  if (!key) {
    throw new ValidationError('TOTP encryption is not configured');
  }
  return key;
}

export async function enrollTotp(
  db: Database,
  eventBus: EventBus,
  userId: string,
): Promise<{ otpauthUri: string; recoveryCodes: string[] }> {
  void eventBus;
  const encryptionKey = requireTotpKey();

  const [userRow] = await db.select(userColumns).from(users).where(eq(users.id, userId)).limit(1);

  if (!userRow) {
    throw new NotFoundError('User', userId);
  }

  const [verifiedRow] = await db
    .select({ id: totpSecrets.id })
    .from(totpSecrets)
    .where(and(eq(totpSecrets.userId, userId), eq(totpSecrets.verified, true)))
    .limit(1);

  if (verifiedRow) {
    throw new ConflictError('TOTP', 'userId', userId);
  }

  await db
    .delete(totpSecrets)
    .where(and(eq(totpSecrets.userId, userId), eq(totpSecrets.verified, false)));

  const secret = new OTPAuth.Secret({ size: 20 });
  const totp = new OTPAuth.TOTP({
    issuer: env.WEBAUTHN_RP_NAME,
    label: userRow.email,
    secret,
    algorithm: 'SHA1',
    digits: 6,
    period: 30,
  });

  const encryptedSecret = encrypt(secret.hex, encryptionKey);

  await db.insert(totpSecrets).values({
    userId,
    secret: encryptedSecret,
    verified: false,
  });

  const rawCodes = generateRecoveryCodesRaw();

  await db.delete(recoveryCodes).where(eq(recoveryCodes.userId, userId));

  for (const code of rawCodes) {
    const codeHash = await hashPassword(code);
    await db.insert(recoveryCodes).values({
      userId,
      codeHash,
    });
  }

  return { otpauthUri: totp.toString(), recoveryCodes: rawCodes };
}

export async function verifyTotpEnrollment(
  db: Database,
  eventBus: EventBus,
  userId: string,
  otp: string,
): Promise<void> {
  const encryptionKey = requireTotpKey();

  const [secretRow] = await db
    .select()
    .from(totpSecrets)
    .where(and(eq(totpSecrets.userId, userId), eq(totpSecrets.verified, false)))
    .limit(1);

  if (!secretRow) {
    throw new NotFoundError('TOTP enrollment', userId);
  }

  const secretHex = decrypt(secretRow.secret, encryptionKey);
  const secret = OTPAuth.Secret.fromHex(secretHex);
  const totp = new OTPAuth.TOTP({
    issuer: env.WEBAUTHN_RP_NAME,
    label: '',
    secret,
    algorithm: 'SHA1',
    digits: 6,
    period: 30,
  });

  const delta = totp.validate({ token: otp, window: 1 });
  if (delta === null) {
    throw new UnauthorizedError('Invalid OTP');
  }

  await db.update(totpSecrets).set({ verified: true }).where(eq(totpSecrets.id, secretRow.id));

  await eventBus.publish(createDomainEvent(MFA_EVENTS.TOTP_ENROLLED, { userId }));
}

export async function disableTotp(
  db: Database,
  eventBus: EventBus,
  userId: string,
  password: string,
): Promise<void> {
  const [row] = await db.select().from(users).where(eq(users.id, userId)).limit(1);

  if (!row || !row.passwordHash) {
    throw new UnauthorizedError('Invalid password');
  }

  const valid = await verifyPassword(row.passwordHash, password);
  if (!valid) {
    throw new UnauthorizedError('Invalid password');
  }

  await db.delete(totpSecrets).where(eq(totpSecrets.userId, userId));
  await db.delete(recoveryCodes).where(eq(recoveryCodes.userId, userId));

  await eventBus.publish(createDomainEvent(MFA_EVENTS.TOTP_DISABLED, { userId }));
}

export async function regenerateRecoveryCodes(
  db: Database,
  eventBus: EventBus,
  userId: string,
  password: string,
): Promise<string[]> {
  const [row] = await db.select().from(users).where(eq(users.id, userId)).limit(1);

  if (!row || !row.passwordHash) {
    throw new UnauthorizedError('Invalid password');
  }

  const valid = await verifyPassword(row.passwordHash, password);
  if (!valid) {
    throw new UnauthorizedError('Invalid password');
  }

  const [verifiedTotp] = await db
    .select({ id: totpSecrets.id })
    .from(totpSecrets)
    .where(and(eq(totpSecrets.userId, userId), eq(totpSecrets.verified, true)))
    .limit(1);

  if (!verifiedTotp) {
    throw new ValidationError('Verified TOTP is not enrolled');
  }

  await db.delete(recoveryCodes).where(eq(recoveryCodes.userId, userId));

  const rawCodes = generateRecoveryCodesRaw();

  for (const code of rawCodes) {
    const codeHash = await hashPassword(code);
    await db.insert(recoveryCodes).values({
      userId,
      codeHash,
    });
  }

  await eventBus.publish(createDomainEvent(MFA_EVENTS.RECOVERY_CODES_GENERATED, { userId }));

  return rawCodes;
}

export async function checkMfaEnrolled(db: Database, userId: string): Promise<boolean> {
  const [row] = await db
    .select({ id: totpSecrets.id })
    .from(totpSecrets)
    .where(and(eq(totpSecrets.userId, userId), eq(totpSecrets.verified, true)))
    .limit(1);

  return Boolean(row);
}

async function countUnusedRecoveryCodes(db: Database, userId: string): Promise<number> {
  const [row] = await db
    .select({ n: count() })
    .from(recoveryCodes)
    .where(and(eq(recoveryCodes.userId, userId), isNull(recoveryCodes.usedAt)));

  return Number(row?.n ?? 0);
}

export async function verifyMfaChallenge(
  db: Database,
  eventBus: EventBus,
  input: MfaVerifyInput,
  meta: { ipAddress?: string; userAgent?: string },
): Promise<MfaVerifyResponse> {
  const hasOtp = input.otp !== undefined;
  const hasRecovery = input.recoveryCode !== undefined;

  if ((hasOtp && hasRecovery) || (!hasOtp && !hasRecovery)) {
    throw new ValidationError('Provide exactly one of otp or recoveryCode');
  }

  const now = new Date();

  const [challenge] = await db
    .select()
    .from(mfaChallenges)
    .where(
      and(
        eq(mfaChallenges.token, input.mfaToken),
        gt(mfaChallenges.expiresAt, now),
        isNull(mfaChallenges.usedAt),
      ),
    )
    .limit(1);

  if (!challenge) {
    throw new UnauthorizedError('Invalid or expired MFA token');
  }

  const userId = challenge.userId;

  if (hasOtp) {
    const encryptionKey = requireTotpKey();

    const [totpRow] = await db
      .select()
      .from(totpSecrets)
      .where(and(eq(totpSecrets.userId, userId), eq(totpSecrets.verified, true)))
      .limit(1);

    if (!totpRow) {
      throw new UnauthorizedError('Invalid OTP');
    }

    const secretHex = decrypt(totpRow.secret, encryptionKey);
    const secret = OTPAuth.Secret.fromHex(secretHex);
    const totp = new OTPAuth.TOTP({
      issuer: env.WEBAUTHN_RP_NAME,
      label: '',
      secret,
      algorithm: 'SHA1',
      digits: 6,
      period: 30,
    });

    const delta = totp.validate({ token: input.otp ?? '', window: 1 });
    if (delta === null) {
      throw new UnauthorizedError('Invalid OTP');
    }
  } else {
    const codeRows = await db
      .select()
      .from(recoveryCodes)
      .where(and(eq(recoveryCodes.userId, userId), isNull(recoveryCodes.usedAt)));

    let matchedId: string | null = null;
    for (const r of codeRows) {
      const ok = await verifyPassword(r.codeHash, input.recoveryCode ?? '');
      if (ok) {
        matchedId = r.id;
        break;
      }
    }

    if (!matchedId) {
      throw new UnauthorizedError('Invalid recovery code');
    }

    await db.update(recoveryCodes).set({ usedAt: now }).where(eq(recoveryCodes.id, matchedId));

    const remaining = await countUnusedRecoveryCodes(db, userId);

    await eventBus.publish(createDomainEvent(MFA_EVENTS.RECOVERY_CODE_USED, { userId, remaining }));
  }

  const session = await createSession(db, eventBus, {
    userId,
    ipAddress: meta.ipAddress,
    userAgent: meta.userAgent,
  });

  await db.update(mfaChallenges).set({ usedAt: now }).where(eq(mfaChallenges.id, challenge.id));

  await eventBus.publish(createDomainEvent(MFA_EVENTS.TOTP_VERIFIED, { userId }));

  const [userRow] = await db.select(userColumns).from(users).where(eq(users.id, userId)).limit(1);

  if (!userRow) {
    throw new NotFoundError('User', userId);
  }

  return {
    token: session.token,
    user: {
      id: userRow.id,
      email: userRow.email,
      displayName: userRow.displayName,
      status: userRow.status as MfaVerifyResponse['user']['status'],
    },
  };
}

export interface MfaServiceDeps {
  db: Database;
  eventBus: EventBus;
}

export function createMfaService(deps: MfaServiceDeps) {
  const { db, eventBus } = deps;
  return {
    enrollTotp: (userId: string) => enrollTotp(db, eventBus, userId),
    verifyTotpEnrollment: (userId: string, otp: string) =>
      verifyTotpEnrollment(db, eventBus, userId, otp),
    disableTotp: (userId: string, password: string) => disableTotp(db, eventBus, userId, password),
    regenerateRecoveryCodes: (userId: string, password: string) =>
      regenerateRecoveryCodes(db, eventBus, userId, password),
    checkMfaEnrolled: (userId: string) => checkMfaEnrolled(db, userId),
    verifyMfaChallenge: (input: MfaVerifyInput, meta: { ipAddress?: string; userAgent?: string }) =>
      verifyMfaChallenge(db, eventBus, input, meta),
  };
}

export type MfaService = ReturnType<typeof createMfaService>;
