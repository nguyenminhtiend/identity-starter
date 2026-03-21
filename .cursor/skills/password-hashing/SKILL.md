---
name: password-hashing
description: >-
  Argon2 password hashing patterns for this identity-starter project using
  @node-rs/argon2. Use when implementing password registration, login
  verification, password change flows, or any operation involving hashing or
  verifying passwords. Also trigger when the user says "hash password", "verify
  password", "argon2", "password security", or references @node-rs/argon2.
  Covers the hash/verify wrapper, recommended Argon2id parameters, where to
  place the utility, and testing patterns.
---

# Password Hashing Skill

Securely hash and verify passwords using `@node-rs/argon2` (v2) with Argon2id.
This package is already installed in `apps/server/package.json`.

## Before Writing

1. Confirm `@node-rs/argon2` is in `apps/server/package.json` dependencies
2. Read the auth module files if they exist, to understand where hashing is called

## The Hash Utility

Create a thin wrapper in the packages/core or directly in the server's shared
utilities. Since password hashing is a core security concern used by the auth
module, place it in the auth module itself or in a shared utility:

**File**: `apps/server/src/core/password.ts`

```typescript
import { hash, verify, Algorithm } from '@node-rs/argon2';

const HASH_OPTIONS = {
  algorithm: Algorithm.Argon2id,
  memoryCost: 65536,  // 64 MiB
  timeCost: 3,        // 3 iterations
  parallelism: 1,     // single-threaded (safe for serverless)
  outputLen: 32,      // 32-byte hash
};

export async function hashPassword(password: string): Promise<string> {
  return hash(password, HASH_OPTIONS);
}

export async function verifyPassword(hash: string, password: string): Promise<boolean> {
  return verify(hash, password);
}
```

The `@node-rs/argon2` `hash` function returns an encoded string in PHC format
(e.g., `$argon2id$v=19$m=65536,t=3,p=1$...`) that includes the algorithm,
parameters, salt, and hash — everything needed for verification.

The `verify` function accepts the encoded hash and the plain password, extracts
params from the hash string, and verifies.

## Argon2id Parameters

| Parameter | Value | Rationale |
|-----------|-------|-----------|
| algorithm | Argon2id | Hybrid: resistant to both side-channel and GPU attacks |
| memoryCost | 65536 (64 MiB) | OWASP minimum recommendation for Argon2id |
| timeCost | 3 | 3 iterations balances security and latency (~200-400ms) |
| parallelism | 1 | Safe for single-threaded/serverless; increase for dedicated servers |
| outputLen | 32 | Standard 256-bit hash output |

These follow OWASP's recommendations for password storage. If hashing takes
too long in development, you can lower `memoryCost` to `19456` (19 MiB) for the
first recommended tier, but keep the production config at 64 MiB.

## Usage in Auth Service

### Registration

```typescript
import { hashPassword } from '../../core/password.js';

export async function register(
  db: Database,
  redis: Redis,
  eventBus: EventBus,
  input: RegisterInput,
): Promise<{ user: User; token: string }> {
  const passwordHash = await hashPassword(input.password);

  const [userRow] = await db
    .insert(users)
    .values({
      email: input.email,
      displayName: input.displayName,
      passwordHash,
    })
    .returning(userColumns);

  // ... create session, return token
}
```

### Login

```typescript
import { verifyPassword } from '../../core/password.js';

export async function login(
  db: Database,
  redis: Redis,
  eventBus: EventBus,
  input: LoginInput,
  meta: { ipAddress: string; userAgent: string | null },
): Promise<{ user: User; token: string }> {
  // Need the full row including passwordHash
  const [row] = await db.select().from(users).where(eq(users.email, input.email)).limit(1);

  if (!row || !row.passwordHash) {
    throw new UnauthorizedError('Invalid email or password');
  }

  const valid = await verifyPassword(row.passwordHash, input.password);
  if (!valid) {
    await eventBus.publish(
      createDomainEvent(AUTH_EVENTS.FAILED_LOGIN, { email: input.email }),
    );
    throw new UnauthorizedError('Invalid email or password');
  }

  // ... create session, return token
}
```

Important security patterns:
- Use the same error message for "user not found" and "wrong password" to prevent
  user enumeration
- Check `row.passwordHash` is not null (passkey-only users don't have passwords)
- Emit `FAILED_LOGIN` event on wrong password (for rate limiting, audit logs)

### Change Password

```typescript
export async function changePassword(
  db: Database,
  eventBus: EventBus,
  userId: string,
  input: ChangePasswordInput,
): Promise<void> {
  const [row] = await db.select().from(users).where(eq(users.id, userId)).limit(1);

  if (!row || !row.passwordHash) {
    throw new NotFoundError('User', userId);
  }

  const valid = await verifyPassword(row.passwordHash, input.currentPassword);
  if (!valid) {
    throw new UnauthorizedError('Current password is incorrect');
  }

  const newHash = await hashPassword(input.newPassword);
  await db.update(users).set({ passwordHash: newHash, updatedAt: new Date() }).where(eq(users.id, userId));

  await eventBus.publish(createDomainEvent(AUTH_EVENTS.PASSWORD_CHANGED, { userId }));
}
```

## Testing

### Unit Tests

Use real Argon2 in unit tests — hashing is fast enough (~200ms) and avoids
brittle mocks. For route unit tests where the service is mocked, password
hashing never runs, so no special handling needed.

```typescript
import { describe, expect, it } from 'vitest';
import { hashPassword, verifyPassword } from '../../core/password.js';

describe('password hashing', () => {
  it('hashes and verifies a password', async () => {
    const hash = await hashPassword('my-secret-password');
    expect(hash).toMatch(/^\$argon2id\$/);
    expect(await verifyPassword(hash, 'my-secret-password')).toBe(true);
  });

  it('rejects wrong password', async () => {
    const hash = await hashPassword('correct-password');
    expect(await verifyPassword(hash, 'wrong-password')).toBe(false);
  });

  it('produces different hashes for same password (unique salt)', async () => {
    const hash1 = await hashPassword('same-password');
    const hash2 = await hashPassword('same-password');
    expect(hash1).not.toBe(hash2);
  });
});
```

### Integration Tests

In auth service integration tests, use real Argon2 — this verifies the full
flow including hash storage and retrieval from PostgreSQL:

```typescript
it('registers and logs in with correct password', async () => {
  const { token } = await register(db, redis, eventBus, {
    email: 'test@example.com',
    password: 'secure-password-123',
    displayName: 'Test User',
  });
  expect(token).toBeDefined();

  const loginResult = await login(db, redis, eventBus, {
    email: 'test@example.com',
    password: 'secure-password-123',
  }, { ipAddress: '127.0.0.1', userAgent: null });
  expect(loginResult.token).toBeDefined();
});

it('rejects login with wrong password', async () => {
  await register(db, redis, eventBus, {
    email: 'test2@example.com',
    password: 'correct-password',
    displayName: 'Test User 2',
  });

  await expect(
    login(db, redis, eventBus, {
      email: 'test2@example.com',
      password: 'wrong-password',
    }, { ipAddress: '127.0.0.1', userAgent: null }),
  ).rejects.toThrow(UnauthorizedError);
});
```

## Security Reminders

- **Never log password hashes** — not even at debug level
- **Never return password hashes in API responses** — use `userColumns` (which excludes `passwordHash`) for all queries that return data to clients
- **Never compare hashes directly** — always use `verify()` which handles timing-safe comparison
- **Salt is automatic** — `@node-rs/argon2` generates a random salt per hash, embedded in the PHC string
- **Rehashing is not needed** — the PHC format stores parameters, so old hashes with different params still verify correctly

## Checklist

- [ ] `core/password.ts` created with `hashPassword` and `verifyPassword`
- [ ] Argon2id parameters set to OWASP recommendations
- [ ] Auth registration uses `hashPassword` before DB insert
- [ ] Auth login uses `verifyPassword` with timing-safe comparison
- [ ] Auth change-password verifies current password before updating
- [ ] Same error message for "user not found" and "wrong password" (prevent enumeration)
- [ ] Password hash never returned in API responses
- [ ] Password hash never logged
- [ ] Unit tests verify hash/verify round-trip and rejection
