import { describe, expect, it } from 'vitest';
import { changePasswordSchema, loginSchema, registerSchema } from '../auth.schemas.js';

describe('registerSchema', () => {
  const validInput = {
    email: 'test@example.com',
    password: 'securepass123',
    displayName: 'Test User',
  };

  it('accepts valid input', () => {
    const result = registerSchema.safeParse(validInput);
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.email).toBe('test@example.com');
      expect(result.data.password).toBe('securepass123');
      expect(result.data.displayName).toBe('Test User');
    }
  });

  it('rejects missing email', () => {
    const result = registerSchema.safeParse({ password: 'securepass123', displayName: 'Test' });
    expect(result.success).toBe(false);
  });

  it('rejects invalid email format', () => {
    const result = registerSchema.safeParse({ ...validInput, email: 'not-an-email' });
    expect(result.success).toBe(false);
  });

  it('rejects missing password', () => {
    const result = registerSchema.safeParse({ email: 'test@example.com', displayName: 'Test' });
    expect(result.success).toBe(false);
  });

  it('rejects password shorter than 8 characters', () => {
    const result = registerSchema.safeParse({ ...validInput, password: 'short' });
    expect(result.success).toBe(false);
  });

  it('accepts password at exactly 8 characters', () => {
    const result = registerSchema.safeParse({ ...validInput, password: '12345678' });
    expect(result.success).toBe(true);
  });

  it('rejects missing displayName', () => {
    const result = registerSchema.safeParse({ email: 'test@example.com', password: 'securepass' });
    expect(result.success).toBe(false);
  });

  it('rejects empty displayName', () => {
    const result = registerSchema.safeParse({ ...validInput, displayName: '' });
    expect(result.success).toBe(false);
  });

  it('rejects displayName exceeding 255 characters', () => {
    const result = registerSchema.safeParse({ ...validInput, displayName: 'a'.repeat(256) });
    expect(result.success).toBe(false);
  });

  it('accepts displayName at exactly 255 characters', () => {
    const result = registerSchema.safeParse({ ...validInput, displayName: 'a'.repeat(255) });
    expect(result.success).toBe(true);
  });

  it('strips unknown fields', () => {
    const result = registerSchema.safeParse({ ...validInput, extra: 'ignored' });
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data).not.toHaveProperty('extra');
    }
  });
});

describe('loginSchema', () => {
  const validInput = {
    email: 'test@example.com',
    password: 'securepass123',
  };

  it('accepts valid input', () => {
    const result = loginSchema.safeParse(validInput);
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.email).toBe('test@example.com');
      expect(result.data.password).toBe('securepass123');
    }
  });

  it('rejects missing email', () => {
    const result = loginSchema.safeParse({ password: 'securepass123' });
    expect(result.success).toBe(false);
  });

  it('rejects invalid email format', () => {
    const result = loginSchema.safeParse({ ...validInput, email: 'bad' });
    expect(result.success).toBe(false);
  });

  it('rejects missing password', () => {
    const result = loginSchema.safeParse({ email: 'test@example.com' });
    expect(result.success).toBe(false);
  });

  it('rejects empty password', () => {
    const result = loginSchema.safeParse({ ...validInput, password: '' });
    expect(result.success).toBe(false);
  });

  it('strips unknown fields', () => {
    const result = loginSchema.safeParse({ ...validInput, extra: 'ignored' });
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data).not.toHaveProperty('extra');
    }
  });
});

describe('changePasswordSchema', () => {
  const validInput = {
    currentPassword: 'oldpassword1',
    newPassword: 'newpassword1',
  };

  it('accepts valid input', () => {
    const result = changePasswordSchema.safeParse(validInput);
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.currentPassword).toBe('oldpassword1');
      expect(result.data.newPassword).toBe('newpassword1');
    }
  });

  it('rejects missing currentPassword', () => {
    const result = changePasswordSchema.safeParse({ newPassword: 'newpassword1' });
    expect(result.success).toBe(false);
  });

  it('rejects empty currentPassword', () => {
    const result = changePasswordSchema.safeParse({ ...validInput, currentPassword: '' });
    expect(result.success).toBe(false);
  });

  it('rejects missing newPassword', () => {
    const result = changePasswordSchema.safeParse({ currentPassword: 'oldpassword1' });
    expect(result.success).toBe(false);
  });

  it('rejects newPassword shorter than 8 characters', () => {
    const result = changePasswordSchema.safeParse({ ...validInput, newPassword: 'short' });
    expect(result.success).toBe(false);
  });

  it('accepts newPassword at exactly 8 characters', () => {
    const result = changePasswordSchema.safeParse({ ...validInput, newPassword: '12345678' });
    expect(result.success).toBe(true);
  });

  it('strips unknown fields', () => {
    const result = changePasswordSchema.safeParse({ ...validInput, extra: 'ignored' });
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data).not.toHaveProperty('extra');
    }
  });
});
