import { describe, expect, it } from 'vitest';
import {
  messageResponseSchema,
  passkeyIdParamSchema,
  passkeyListItemSchema,
  passkeyListResponseSchema,
  profileResponseSchema,
  renamePasskeySchema,
  sessionIdParamSchema,
  sessionListItemSchema,
  sessionListResponseSchema,
  updateProfileSchema,
} from '../account.schemas.js';

describe('profileResponseSchema', () => {
  const valid = {
    id: '550e8400-e29b-41d4-a716-446655440000',
    email: 'test@example.com',
    emailVerified: true,
    displayName: 'Test',
    status: 'active' as const,
    metadata: { a: 1 },
    createdAt: new Date(),
  };

  it('accepts valid profile', () => {
    const result = profileResponseSchema.safeParse(valid);
    expect(result.success).toBe(true);
  });

  it('rejects invalid status', () => {
    const result = profileResponseSchema.safeParse({ ...valid, status: 'banned' });
    expect(result.success).toBe(false);
  });

  it('rejects invalid email', () => {
    const result = profileResponseSchema.safeParse({ ...valid, email: 'nope' });
    expect(result.success).toBe(false);
  });
});

describe('updateProfileSchema', () => {
  it('accepts empty object', () => {
    const result = updateProfileSchema.safeParse({});
    expect(result.success).toBe(true);
  });

  it('accepts displayName only', () => {
    const result = updateProfileSchema.safeParse({ displayName: 'A' });
    expect(result.success).toBe(true);
  });

  it('accepts metadata only', () => {
    const result = updateProfileSchema.safeParse({ metadata: { x: true } });
    expect(result.success).toBe(true);
  });

  it('rejects empty displayName', () => {
    const result = updateProfileSchema.safeParse({ displayName: '' });
    expect(result.success).toBe(false);
  });

  it('rejects displayName over 255 chars', () => {
    const result = updateProfileSchema.safeParse({ displayName: 'a'.repeat(256) });
    expect(result.success).toBe(false);
  });
});

describe('sessionListItemSchema', () => {
  const valid = {
    id: '550e8400-e29b-41d4-a716-446655440000',
    ipAddress: '127.0.0.1',
    userAgent: 'vitest',
    lastActiveAt: new Date(),
    createdAt: new Date(),
    isCurrent: true,
  };

  it('accepts null ip and user agent', () => {
    const result = sessionListItemSchema.safeParse({
      ...valid,
      ipAddress: null,
      userAgent: null,
    });
    expect(result.success).toBe(true);
  });

  it('rejects missing isCurrent', () => {
    const result = sessionListItemSchema.safeParse({
      id: valid.id,
      ipAddress: valid.ipAddress,
      userAgent: valid.userAgent,
      lastActiveAt: valid.lastActiveAt,
      createdAt: valid.createdAt,
    });
    expect(result.success).toBe(false);
  });
});

describe('sessionListResponseSchema', () => {
  it('accepts array of session items', () => {
    const result = sessionListResponseSchema.safeParse([]);
    expect(result.success).toBe(true);
  });
});

describe('sessionIdParamSchema', () => {
  it('accepts valid UUID', () => {
    const result = sessionIdParamSchema.safeParse({
      id: '550e8400-e29b-41d4-a716-446655440000',
    });
    expect(result.success).toBe(true);
  });

  it('rejects invalid id', () => {
    const result = sessionIdParamSchema.safeParse({ id: 'bad' });
    expect(result.success).toBe(false);
  });
});

describe('passkeyListItemSchema', () => {
  const valid = {
    id: '550e8400-e29b-41d4-a716-446655440000',
    credentialId: 'cred',
    deviceType: 'singleDevice',
    backedUp: false,
    name: null,
    aaguid: null,
    createdAt: new Date(),
  };

  it('accepts valid passkey item', () => {
    expect(passkeyListItemSchema.safeParse(valid).success).toBe(true);
  });
});

describe('passkeyListResponseSchema', () => {
  it('accepts empty list', () => {
    expect(passkeyListResponseSchema.safeParse([]).success).toBe(true);
  });
});

describe('passkeyIdParamSchema', () => {
  it('accepts valid UUID', () => {
    expect(
      passkeyIdParamSchema.safeParse({ id: '550e8400-e29b-41d4-a716-446655440000' }).success,
    ).toBe(true);
  });
});

describe('renamePasskeySchema', () => {
  it('accepts valid name', () => {
    expect(renamePasskeySchema.safeParse({ name: 'My key' }).success).toBe(true);
  });

  it('rejects empty name', () => {
    expect(renamePasskeySchema.safeParse({ name: '' }).success).toBe(false);
  });
});

describe('messageResponseSchema', () => {
  it('accepts message', () => {
    expect(messageResponseSchema.safeParse({ message: 'ok' }).success).toBe(true);
  });
});
