import { describe, expect, it } from 'vitest';
import {
  disableTotpSchema,
  enrollTotpResponseSchema,
  messageResponseSchema,
  mfaVerifyResponseSchema,
  mfaVerifySchema,
  regenerateRecoveryCodesResponseSchema,
  regenerateRecoveryCodesSchema,
  verifyTotpEnrollmentSchema,
} from '../mfa.schemas.js';

describe('enrollTotpResponseSchema', () => {
  it('accepts valid response', () => {
    const result = enrollTotpResponseSchema.safeParse({
      otpauthUri: 'otpauth://totp/Test:u@x.com?secret=ABC&issuer=Test',
      recoveryCodes: ['ABCD-EFGH', '1234-5678'],
    });
    expect(result.success).toBe(true);
  });

  it('rejects missing fields', () => {
    expect(enrollTotpResponseSchema.safeParse({ otpauthUri: 'x' }).success).toBe(false);
    expect(enrollTotpResponseSchema.safeParse({ recoveryCodes: [] }).success).toBe(false);
  });
});

describe('verifyTotpEnrollmentSchema', () => {
  it('accepts 6-digit otp', () => {
    const result = verifyTotpEnrollmentSchema.safeParse({ otp: '123456' });
    expect(result.success).toBe(true);
  });

  it('rejects wrong length', () => {
    expect(verifyTotpEnrollmentSchema.safeParse({ otp: '12345' }).success).toBe(false);
    expect(verifyTotpEnrollmentSchema.safeParse({ otp: '1234567' }).success).toBe(false);
  });
});

describe('disableTotpSchema', () => {
  it('accepts non-empty password', () => {
    expect(disableTotpSchema.safeParse({ password: 'x' }).success).toBe(true);
  });

  it('rejects empty password', () => {
    expect(disableTotpSchema.safeParse({ password: '' }).success).toBe(false);
  });
});

describe('regenerateRecoveryCodesSchema', () => {
  it('accepts non-empty password', () => {
    expect(regenerateRecoveryCodesSchema.safeParse({ password: 'secret1' }).success).toBe(true);
  });

  it('rejects empty password', () => {
    expect(regenerateRecoveryCodesSchema.safeParse({ password: '' }).success).toBe(false);
  });
});

describe('regenerateRecoveryCodesResponseSchema', () => {
  it('accepts codes array', () => {
    const result = regenerateRecoveryCodesResponseSchema.safeParse({
      recoveryCodes: ['AAAA-BBBB'],
    });
    expect(result.success).toBe(true);
  });
});

describe('mfaVerifySchema', () => {
  it('accepts mfaToken with otp', () => {
    const result = mfaVerifySchema.safeParse({
      mfaToken: 'tok',
      otp: '123456',
    });
    expect(result.success).toBe(true);
  });

  it('accepts mfaToken with recoveryCode', () => {
    const result = mfaVerifySchema.safeParse({
      mfaToken: 'tok',
      recoveryCode: 'ABCD-EFGH',
    });
    expect(result.success).toBe(true);
  });

  it('rejects missing mfaToken', () => {
    expect(mfaVerifySchema.safeParse({ otp: '123456' }).success).toBe(false);
  });
});

describe('mfaVerifyResponseSchema', () => {
  it('accepts valid shape', () => {
    const result = mfaVerifyResponseSchema.safeParse({
      token: 'sess',
      user: {
        id: '550e8400-e29b-41d4-a716-446655440000',
        email: 'a@b.com',
        displayName: 'A',
        status: 'active',
      },
    });
    expect(result.success).toBe(true);
  });

  it('rejects invalid user id', () => {
    const result = mfaVerifyResponseSchema.safeParse({
      token: 'sess',
      user: {
        id: 'not-uuid',
        email: 'a@b.com',
        displayName: 'A',
        status: 'active',
      },
    });
    expect(result.success).toBe(false);
  });

  it('rejects invalid email', () => {
    const result = mfaVerifyResponseSchema.safeParse({
      token: 'sess',
      user: {
        id: '550e8400-e29b-41d4-a716-446655440000',
        email: 'bad',
        displayName: 'A',
        status: 'active',
      },
    });
    expect(result.success).toBe(false);
  });
});

describe('messageResponseSchema', () => {
  it('accepts message', () => {
    expect(messageResponseSchema.safeParse({ message: 'ok' }).success).toBe(true);
  });
});
