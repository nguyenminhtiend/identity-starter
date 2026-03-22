import { describe, expect, it } from 'vitest';
import { forgotPasswordSchema, resetPasswordSchema } from '../password-reset.schemas.js';

describe('forgotPasswordSchema', () => {
  const validInput = { email: 'test@example.com' };

  it('accepts valid input', () => {
    const result = forgotPasswordSchema.safeParse(validInput);
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.email).toBe('test@example.com');
    }
  });

  it('rejects missing email', () => {
    const result = forgotPasswordSchema.safeParse({});
    expect(result.success).toBe(false);
  });

  it('rejects invalid email format', () => {
    const result = forgotPasswordSchema.safeParse({ email: 'not-email' });
    expect(result.success).toBe(false);
  });

  it('strips unknown fields', () => {
    const result = forgotPasswordSchema.safeParse({ ...validInput, extra: 'x' });
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data).not.toHaveProperty('extra');
    }
  });
});

describe('resetPasswordSchema', () => {
  const validInput = {
    token: 'reset-token-value',
    newPassword: 'newpassword1',
  };

  it('accepts valid input', () => {
    const result = resetPasswordSchema.safeParse(validInput);
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.token).toBe('reset-token-value');
      expect(result.data.newPassword).toBe('newpassword1');
    }
  });

  it('rejects empty token', () => {
    const result = resetPasswordSchema.safeParse({ ...validInput, token: '' });
    expect(result.success).toBe(false);
  });

  it('rejects missing token', () => {
    const result = resetPasswordSchema.safeParse({ newPassword: 'newpassword1' });
    expect(result.success).toBe(false);
  });

  it('rejects missing newPassword', () => {
    const result = resetPasswordSchema.safeParse({ token: 't' });
    expect(result.success).toBe(false);
  });

  it('rejects newPassword shorter than 8 characters', () => {
    const result = resetPasswordSchema.safeParse({ ...validInput, newPassword: 'short' });
    expect(result.success).toBe(false);
  });

  it('accepts newPassword at exactly 8 characters', () => {
    const result = resetPasswordSchema.safeParse({ ...validInput, newPassword: '12345678' });
    expect(result.success).toBe(true);
  });

  it('strips unknown fields', () => {
    const result = resetPasswordSchema.safeParse({ ...validInput, extra: 'ignored' });
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data).not.toHaveProperty('extra');
    }
  });
});
