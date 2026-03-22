import { describe, expect, it } from 'vitest';
import { assignRoleSchema, createRoleSchema, setRolePermissionsSchema } from '../rbac.schemas.js';

const validUuid = '550e8400-e29b-41d4-a716-446655440000';

describe('createRoleSchema', () => {
  it('accepts valid role with name only', () => {
    const result = createRoleSchema.safeParse({ name: 'moderator' });
    expect(result.success).toBe(true);
  });

  it('accepts valid role with name and description', () => {
    const result = createRoleSchema.safeParse({
      name: 'moderator',
      description: 'Can moderate',
    });
    expect(result.success).toBe(true);
  });

  it('rejects empty name', () => {
    const result = createRoleSchema.safeParse({ name: '' });
    expect(result.success).toBe(false);
  });

  it('rejects name over 100 chars', () => {
    const result = createRoleSchema.safeParse({ name: 'a'.repeat(101) });
    expect(result.success).toBe(false);
  });
});

describe('setRolePermissionsSchema', () => {
  it('accepts non-empty permission id array', () => {
    const result = setRolePermissionsSchema.safeParse({
      permissionIds: [validUuid],
    });
    expect(result.success).toBe(true);
  });

  it('rejects empty permissionIds array', () => {
    const result = setRolePermissionsSchema.safeParse({ permissionIds: [] });
    expect(result.success).toBe(false);
  });

  it('rejects non-uuid permission id', () => {
    const result = setRolePermissionsSchema.safeParse({
      permissionIds: ['not-uuid'],
    });
    expect(result.success).toBe(false);
  });
});

describe('assignRoleSchema', () => {
  it('accepts valid roleId', () => {
    const result = assignRoleSchema.safeParse({ roleId: validUuid });
    expect(result.success).toBe(true);
  });

  it('rejects invalid roleId', () => {
    const result = assignRoleSchema.safeParse({ roleId: 'bad' });
    expect(result.success).toBe(false);
  });
});
