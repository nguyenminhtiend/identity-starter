import { faker } from '@faker-js/faker';
import type { Database } from '@identity-starter/db';
import { mfaChallenges, users } from '@identity-starter/db';
import { eq } from 'drizzle-orm';
import * as OTPAuth from 'otpauth';
import { hashPassword } from '../../../core/password.js';
import type { EventBus } from '../../../infra/event-bus.js';
import { makeCreateUserInput } from '../../user/__tests__/user.factory.js';
import { createUser } from '../../user/user.service.js';
import type {
  DisableTotpInput,
  MfaVerifyInput,
  RegenerateRecoveryCodesInput,
  VerifyTotpEnrollmentInput,
} from '../mfa.schemas.js';
import { enrollTotp, verifyTotpEnrollment } from '../mfa.service.js';

export function makeVerifyTotpInput(
  overrides?: Partial<VerifyTotpEnrollmentInput>,
): VerifyTotpEnrollmentInput {
  return {
    otp: '123456',
    ...overrides,
  };
}

export function makeDisableTotpInput(overrides?: Partial<DisableTotpInput>): DisableTotpInput {
  return {
    password: faker.internet.password({ length: 12 }),
    ...overrides,
  };
}

export function makeRegenerateRecoveryCodesInput(
  overrides?: Partial<RegenerateRecoveryCodesInput>,
): RegenerateRecoveryCodesInput {
  return {
    password: faker.internet.password({ length: 12 }),
    ...overrides,
  };
}

export function makeMfaVerifyInput(overrides?: Partial<MfaVerifyInput>): MfaVerifyInput {
  return {
    mfaToken: faker.string.alphanumeric(32),
    otp: '123456',
    ...overrides,
  };
}

export async function createMfaChallengeRow(
  db: Database,
  input: { userId: string; token: string; expiresAt: Date },
): Promise<void> {
  await db.insert(mfaChallenges).values({
    userId: input.userId,
    token: input.token,
    expiresAt: input.expiresAt,
  });
}

/** Creates a user with Argon2 password hash suitable for step-up flows. */
export async function createUserWithPassword(db: Database, eventBus: EventBus, password: string) {
  const input = makeCreateUserInput();
  const user = await createUser(db, eventBus, input);
  const passwordHash = await hashPassword(password);
  await db.update(users).set({ passwordHash }).where(eq(users.id, user.id));
  return { user, email: input.email, password };
}

export async function enrollAndVerifyTotp(
  db: Database,
  eventBus: EventBus,
  userId: string,
): Promise<{ otpauthUri: string; recoveryCodes: string[] }> {
  const { otpauthUri, recoveryCodes } = await enrollTotp(db, userId);
  const parsed = OTPAuth.URI.parse(otpauthUri);
  if (!(parsed instanceof OTPAuth.TOTP)) {
    throw new Error('Expected TOTP key URI');
  }
  const otp = parsed.generate();
  await verifyTotpEnrollment(db, eventBus, userId, otp);
  return { otpauthUri, recoveryCodes };
}
