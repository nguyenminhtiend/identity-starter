import { describe, expect, it } from 'vitest';
import { createUserSchema, userIdParamSchema } from '../user.schemas.js';

describe('createUserSchema', () => {
  const validInput = {
    email: 'test@example.com',
    displayName: 'Test User',
  };

  it('accepts valid input with required fields only', () => {
    const result = createUserSchema.safeParse(validInput);
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.email).toBe('test@example.com');
      expect(result.data.displayName).toBe('Test User');
      expect(result.data.metadata).toEqual({});
    }
  });

  it('accepts valid input with all fields', () => {
    const result = createUserSchema.safeParse({
      ...validInput,
      metadata: { role: 'admin' },
    });
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.metadata).toEqual({ role: 'admin' });
    }
  });

  it('defaults metadata to empty object', () => {
    const result = createUserSchema.safeParse(validInput);
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.metadata).toEqual({});
    }
  });

  it('rejects missing email', () => {
    const result = createUserSchema.safeParse({ displayName: 'Test' });
    expect(result.success).toBe(false);
  });

  it('rejects invalid email format', () => {
    const result = createUserSchema.safeParse({ ...validInput, email: 'not-an-email' });
    expect(result.success).toBe(false);
  });

  it('rejects empty email', () => {
    const result = createUserSchema.safeParse({ ...validInput, email: '' });
    expect(result.success).toBe(false);
  });

  it('rejects missing displayName', () => {
    const result = createUserSchema.safeParse({ email: 'test@example.com' });
    expect(result.success).toBe(false);
  });

  it('rejects empty displayName', () => {
    const result = createUserSchema.safeParse({ ...validInput, displayName: '' });
    expect(result.success).toBe(false);
  });

  it('rejects displayName exceeding 255 characters', () => {
    const result = createUserSchema.safeParse({
      ...validInput,
      displayName: 'a'.repeat(256),
    });
    expect(result.success).toBe(false);
  });

  it('accepts displayName at exactly 255 characters', () => {
    const result = createUserSchema.safeParse({
      ...validInput,
      displayName: 'a'.repeat(255),
    });
    expect(result.success).toBe(true);
  });

  it('strips unknown fields', () => {
    const result = createUserSchema.safeParse({
      ...validInput,
      unknownField: 'should be stripped',
    });
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data).not.toHaveProperty('unknownField');
    }
  });
});

describe('userIdParamSchema', () => {
  it('accepts a valid UUID', () => {
    const result = userIdParamSchema.safeParse({ id: '550e8400-e29b-41d4-a716-446655440000' });
    expect(result.success).toBe(true);
  });

  it('rejects an invalid UUID', () => {
    const result = userIdParamSchema.safeParse({ id: 'not-a-uuid' });
    expect(result.success).toBe(false);
  });

  it('rejects missing id', () => {
    const result = userIdParamSchema.safeParse({});
    expect(result.success).toBe(false);
  });

  it('rejects empty string id', () => {
    const result = userIdParamSchema.safeParse({ id: '' });
    expect(result.success).toBe(false);
  });
});
