import { describe, expect, it } from 'vitest';
import {
  resendVerificationResponseSchema,
  resendVerificationSchema,
  verifyEmailResponseSchema,
  verifyEmailSchema,
} from '../email-verification.schemas.js';

describe('verifyEmailSchema', () => {
  const validInput = { token: 'abc123' };

  it('accepts valid input', () => {
    const result = verifyEmailSchema.safeParse(validInput);
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.token).toBe('abc123');
    }
  });

  it('rejects missing token', () => {
    const result = verifyEmailSchema.safeParse({});
    expect(result.success).toBe(false);
  });

  it('rejects empty token', () => {
    const result = verifyEmailSchema.safeParse({ token: '' });
    expect(result.success).toBe(false);
  });

  it('strips unknown fields', () => {
    const result = verifyEmailSchema.safeParse({ ...validInput, extra: 'ignored' });
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data).not.toHaveProperty('extra');
    }
  });
});

describe('verifyEmailResponseSchema', () => {
  it('accepts valid response', () => {
    const result = verifyEmailResponseSchema.safeParse({ message: 'ok' });
    expect(result.success).toBe(true);
  });

  it('rejects missing message', () => {
    const result = verifyEmailResponseSchema.safeParse({});
    expect(result.success).toBe(false);
  });
});

describe('resendVerificationSchema', () => {
  const validInput = { email: 'test@example.com' };

  it('accepts valid input', () => {
    const result = resendVerificationSchema.safeParse(validInput);
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.email).toBe('test@example.com');
    }
  });

  it('rejects missing email', () => {
    const result = resendVerificationSchema.safeParse({});
    expect(result.success).toBe(false);
  });

  it('rejects invalid email format', () => {
    const result = resendVerificationSchema.safeParse({ email: 'not-email' });
    expect(result.success).toBe(false);
  });

  it('strips unknown fields', () => {
    const result = resendVerificationSchema.safeParse({ ...validInput, extra: 'ignored' });
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data).not.toHaveProperty('extra');
    }
  });
});

describe('resendVerificationResponseSchema', () => {
  it('accepts message only', () => {
    const result = resendVerificationResponseSchema.safeParse({ message: 'sent' });
    expect(result.success).toBe(true);
  });

  it('parses message and omits extra keys from output', () => {
    const result = resendVerificationResponseSchema.safeParse({
      message: 'sent',
      verificationToken: 'tok',
    });
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data).toEqual({ message: 'sent' });
    }
  });

  it('rejects missing message', () => {
    const result = resendVerificationResponseSchema.safeParse({ verificationToken: 'x' });
    expect(result.success).toBe(false);
  });
});
