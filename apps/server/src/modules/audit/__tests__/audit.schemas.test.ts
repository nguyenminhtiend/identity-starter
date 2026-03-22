import { describe, expect, it } from 'vitest';
import { auditExportQuerySchema, auditLogQuerySchema } from '../audit.schemas.js';

describe('auditLogQuerySchema', () => {
  it('defaults page to 1 and limit to 20', () => {
    const result = auditLogQuerySchema.safeParse({});
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.page).toBe(1);
      expect(result.data.limit).toBe(20);
    }
  });

  it('accepts combined filters', () => {
    const actorId = '550e8400-e29b-41d4-a716-446655440000';
    const resourceId = '6ba7b810-9dad-11d1-80b4-00c04fd430c8';
    const result = auditLogQuerySchema.safeParse({
      page: '2',
      limit: '10',
      actorId,
      action: 'user.update',
      resourceType: 'user',
      resourceId,
      startDate: '2025-01-01T00:00:00.000Z',
      endDate: '2025-12-31T23:59:59.999Z',
    });
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.page).toBe(2);
      expect(result.data.limit).toBe(10);
      expect(result.data.actorId).toBe(actorId);
      expect(result.data.action).toBe('user.update');
      expect(result.data.resourceType).toBe('user');
      expect(result.data.resourceId).toBe(resourceId);
      expect(result.data.startDate).toBeInstanceOf(Date);
      expect(result.data.endDate).toBeInstanceOf(Date);
    }
  });

  it('rejects invalid actorId UUID', () => {
    const result = auditLogQuerySchema.safeParse({ actorId: 'not-a-uuid' });
    expect(result.success).toBe(false);
  });

  it('coerces date strings to Date for startDate and endDate', () => {
    const result = auditLogQuerySchema.safeParse({
      startDate: '2024-06-15',
      endDate: '2024-06-16T12:00:00.000Z',
    });
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.startDate).toBeInstanceOf(Date);
      expect(result.data.endDate).toBeInstanceOf(Date);
    }
  });
});

describe('auditExportQuerySchema', () => {
  it('accepts empty object', () => {
    const result = auditExportQuerySchema.safeParse({});
    expect(result.success).toBe(true);
  });

  it('accepts date range filters', () => {
    const result = auditExportQuerySchema.safeParse({
      startDate: '2025-01-01',
      endDate: '2025-03-01',
    });
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.startDate).toBeInstanceOf(Date);
      expect(result.data.endDate).toBeInstanceOf(Date);
    }
  });
});
