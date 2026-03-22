import { describe, expect, it } from 'vitest';
import {
  sessionListQuerySchema,
  updateUserStatusSchema,
  userListQuerySchema,
} from '../admin.schemas.js';

describe('userListQuerySchema', () => {
  it('defaults page to 1 and limit to 20', () => {
    const result = userListQuerySchema.safeParse({});
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.page).toBe(1);
      expect(result.data.limit).toBe(20);
    }
  });

  it('applies status filter', () => {
    const result = userListQuerySchema.safeParse({ status: 'suspended' });
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.status).toBe('suspended');
    }
  });

  it('applies email filter', () => {
    const result = userListQuerySchema.safeParse({ email: 'admin@example.com' });
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.email).toBe('admin@example.com');
    }
  });

  it('coerces page and limit from strings', () => {
    const result = userListQuerySchema.safeParse({ page: '2', limit: '50' });
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.page).toBe(2);
      expect(result.data.limit).toBe(50);
    }
  });
});

describe('updateUserStatusSchema', () => {
  it("accepts status 'active'", () => {
    const result = updateUserStatusSchema.safeParse({ status: 'active' });
    expect(result.success).toBe(true);
  });

  it("accepts status 'suspended'", () => {
    const result = updateUserStatusSchema.safeParse({ status: 'suspended' });
    expect(result.success).toBe(true);
  });

  it("rejects status 'deleted'", () => {
    const result = updateUserStatusSchema.safeParse({ status: 'deleted' });
    expect(result.success).toBe(false);
  });
});

describe('sessionListQuerySchema', () => {
  it('defaults page and limit', () => {
    const result = sessionListQuerySchema.safeParse({});
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.page).toBe(1);
      expect(result.data.limit).toBe(20);
    }
  });

  it('accepts optional userId filter', () => {
    const userId = '550e8400-e29b-41d4-a716-446655440000';
    const result = sessionListQuerySchema.safeParse({ userId });
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.userId).toBe(userId);
    }
  });

  it('rejects invalid userId', () => {
    const result = sessionListQuerySchema.safeParse({ userId: 'not-a-uuid' });
    expect(result.success).toBe(false);
  });
});
