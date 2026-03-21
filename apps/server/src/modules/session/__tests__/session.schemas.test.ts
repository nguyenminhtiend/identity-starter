import { describe, expect, it } from 'vitest';
import { createSessionSchema, sessionIdParamSchema } from '../session.schemas.js';

describe('createSessionSchema', () => {
  const userId = '550e8400-e29b-41d4-a716-446655440000';

  it('accepts valid input with all fields', () => {
    const result = createSessionSchema.safeParse({
      userId,
      ipAddress: '127.0.0.1',
      userAgent: 'vitest',
    });
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.userId).toBe(userId);
      expect(result.data.ipAddress).toBe('127.0.0.1');
      expect(result.data.userAgent).toBe('vitest');
    }
  });

  it('accepts valid input with userId only (optional fields omitted)', () => {
    const result = createSessionSchema.safeParse({ userId });
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.userId).toBe(userId);
      expect(result.data.ipAddress).toBeUndefined();
      expect(result.data.userAgent).toBeUndefined();
    }
  });

  it('rejects missing userId', () => {
    const result = createSessionSchema.safeParse({ ipAddress: '127.0.0.1' });
    expect(result.success).toBe(false);
  });

  it('rejects invalid UUID for userId', () => {
    const result = createSessionSchema.safeParse({ userId: 'not-a-uuid' });
    expect(result.success).toBe(false);
  });

  it('rejects empty string userId', () => {
    const result = createSessionSchema.safeParse({ userId: '' });
    expect(result.success).toBe(false);
  });

  it('strips unknown fields', () => {
    const result = createSessionSchema.safeParse({
      userId,
      extra: 'ignored',
    });
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data).not.toHaveProperty('extra');
    }
  });
});

describe('sessionIdParamSchema', () => {
  it('accepts a valid UUID', () => {
    const result = sessionIdParamSchema.safeParse({ id: '550e8400-e29b-41d4-a716-446655440000' });
    expect(result.success).toBe(true);
  });

  it('rejects an invalid UUID', () => {
    const result = sessionIdParamSchema.safeParse({ id: 'not-a-uuid' });
    expect(result.success).toBe(false);
  });

  it('rejects missing id', () => {
    const result = sessionIdParamSchema.safeParse({});
    expect(result.success).toBe(false);
  });

  it('rejects empty string id', () => {
    const result = sessionIdParamSchema.safeParse({ id: '' });
    expect(result.success).toBe(false);
  });
});
