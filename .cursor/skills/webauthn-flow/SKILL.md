---
name: webauthn-flow
description: >-
  WebAuthn/passkey registration and authentication flows for this
  identity-starter project using @simplewebauthn/server v13. Use when
  implementing passkey registration, passkey login, WebAuthn challenge
  generation, credential verification, credential storage, or any
  passkey-related feature. Also trigger when the user says "add passkey",
  "webauthn", "passkey login", "passwordless", "FIDO2", "register passkey",
  "credential storage", or references @simplewebauthn/server. Covers the full
  multi-step ceremony from options generation through verification and DB storage.
---

# WebAuthn Flow Skill

Implement WebAuthn passkey registration and authentication using
`@simplewebauthn/server` v13. This library is NOT yet installed — add it
before using this skill.

## Before Writing

1. Install: `pnpm --filter server add @simplewebauthn/server`
2. Read `packages/db/src/schema/passkey.ts` for the passkeys table schema
3. Read the `redis-integration` skill for challenge storage in Redis
4. Read `apps/server/src/core/env.ts` for WebAuthn env variables
5. Read the `auth-middleware` skill for protecting registration endpoints

## Environment Variables

Add to `apps/server/src/core/env.ts`:

```typescript
const EnvSchema = z.object({
  // ... existing vars
  WEBAUTHN_RP_NAME: z.string().default('Identity Starter'),
  WEBAUTHN_RP_ID: z.string().default('localhost'),
  WEBAUTHN_ORIGIN: z.string().default('http://localhost:3000'),
});
```

These identify your Relying Party (RP) to authenticators:
- `RP_NAME`: Human-readable site name shown in browser prompts
- `RP_ID`: Domain identifier (use `localhost` for local dev)
- `ORIGIN`: Full origin URL (protocol + domain + port, no trailing slash)

## Passkey DB Schema

In `packages/db/src/schema/passkey.ts`:

```typescript
import { sql } from 'drizzle-orm';
import { boolean, customType, integer, pgTable, text, timestamp, uuid } from 'drizzle-orm/pg-core';
import { users } from './user.js';

const bytea = customType<{ data: Uint8Array; driverParam: Buffer }>({
  dataType() {
    return 'bytea';
  },
  toDriver(value: Uint8Array): Buffer {
    return Buffer.from(value);
  },
  fromDriver(value: Buffer): Uint8Array {
    return new Uint8Array(value);
  },
});

export const passkeys = pgTable('passkeys', {
  id: uuid('id').primaryKey().default(sql`uuidv7()`),
  userId: uuid('user_id').notNull().references(() => users.id, { onDelete: 'cascade' }),
  credentialId: text('credential_id').notNull().unique(),
  publicKey: bytea('public_key').notNull(),
  counter: integer('counter').notNull().default(0),
  deviceType: text('device_type').notNull(),
  backedUp: boolean('backed_up').notNull().default(false),
  transports: text('transports').array(),
  name: text('name'),
  createdAt: timestamp('created_at').notNull().defaultNow(),
});
```

The `bytea` custom type handles Uint8Array ↔ Buffer conversion needed for
COSE public keys. PostgreSQL stores the raw bytes efficiently as `bytea`.

## WebAuthn Flow Overview

Two ceremonies, each with two steps:

```
Registration (authenticated user adds a passkey):
  1. Server → generateRegistrationOptions() → client
  2. Client performs ceremony → server → verifyRegistrationResponse() → store credential

Authentication (passwordless login):
  1. Server → generateAuthenticationOptions() → client
  2. Client performs ceremony → server → verifyAuthenticationResponse() → create session
```

Challenges are generated server-side, stored in Redis with a 5-minute TTL,
and consumed on verification (one-time use).

## Registration Flow

### Step 1: Generate Registration Options

```typescript
import {
  generateRegistrationOptions,
  type GenerateRegistrationOptionsOpts,
} from '@simplewebauthn/server';
import type { Redis } from 'ioredis';
import { env } from '../../core/env.js';

export async function getRegistrationOptions(
  db: Database,
  redis: Redis,
  userId: string,
): Promise<PublicKeyCredentialCreationOptionsJSON> {
  // Get user info for the registration
  const [user] = await db
    .select({ id: users.id, email: users.email, displayName: users.displayName })
    .from(users)
    .where(eq(users.id, userId))
    .limit(1);

  if (!user) {
    throw new NotFoundError('User', userId);
  }

  // Get existing passkeys to prevent re-registration
  const existingPasskeys = await db
    .select({ credentialId: passkeys.credentialId, transports: passkeys.transports })
    .from(passkeys)
    .where(eq(passkeys.userId, userId));

  const options = await generateRegistrationOptions({
    rpName: env.WEBAUTHN_RP_NAME,
    rpID: env.WEBAUTHN_RP_ID,
    userName: user.email,
    attestationType: 'none',
    excludeCredentials: existingPasskeys.map((p) => ({
      id: p.credentialId,
      transports: p.transports as AuthenticatorTransportFuture[] | undefined,
    })),
    authenticatorSelection: {
      residentKey: 'preferred',
      userVerification: 'preferred',
    },
  });

  // Store challenge in Redis (5 min TTL)
  await redis.set(`challenge:${userId}`, options.challenge, 'EX', 300);

  return options;
}
```

### Step 2: Verify Registration

```typescript
import {
  verifyRegistrationResponse,
  type VerifyRegistrationResponseOpts,
} from '@simplewebauthn/server';

export async function verifyRegistration(
  db: Database,
  redis: Redis,
  eventBus: EventBus,
  userId: string,
  response: RegistrationResponseJSON,
  passKeyName?: string,
): Promise<Passkey> {
  // Retrieve and consume the challenge (one-time use)
  const expectedChallenge = await redis.getdel(`challenge:${userId}`);
  if (!expectedChallenge) {
    throw new UnauthorizedError('Challenge expired or not found');
  }

  const verification = await verifyRegistrationResponse({
    response,
    expectedChallenge,
    expectedOrigin: env.WEBAUTHN_ORIGIN,
    expectedRPID: env.WEBAUTHN_RP_ID,
  });

  if (!verification.verified || !verification.registrationInfo) {
    throw new UnauthorizedError('Passkey registration verification failed');
  }

  const { credential, credentialDeviceType, credentialBackedUp } = verification.registrationInfo;

  // Store the credential in DB
  const [row] = await db
    .insert(passkeys)
    .values({
      userId,
      credentialId: credential.id,
      publicKey: credential.publicKey,
      counter: credential.counter,
      deviceType: credentialDeviceType,
      backedUp: credentialBackedUp,
      transports: credential.transports ?? null,
      name: passKeyName ?? null,
    })
    .returning();

  const passkey = mapToPasskey(row);
  await eventBus.publish(createDomainEvent(PASSKEY_EVENTS.REGISTERED, { passkey }));
  return passkey;
}
```

## Authentication Flow

### Step 1: Generate Authentication Options

```typescript
import { generateAuthenticationOptions } from '@simplewebauthn/server';

export async function getAuthenticationOptions(
  db: Database,
  redis: Redis,
): Promise<PublicKeyCredentialRequestOptionsJSON> {
  // For discoverable credentials (passkeys), no need to specify allowCredentials
  const options = await generateAuthenticationOptions({
    rpID: env.WEBAUTHN_RP_ID,
    userVerification: 'preferred',
  });

  // Store challenge with a temporary key (no userId yet — user is anonymous)
  // Use the challenge itself as the key since it's unique
  await redis.set(`challenge:webauthn:${options.challenge}`, '1', 'EX', 300);

  return options;
}
```

### Step 2: Verify Authentication

```typescript
import {
  verifyAuthenticationResponse,
  type WebAuthnCredential,
} from '@simplewebauthn/server';

export async function verifyAuthentication(
  db: Database,
  redis: Redis,
  eventBus: EventBus,
  response: AuthenticationResponseJSON,
  meta: { ipAddress: string; userAgent: string | null },
): Promise<{ user: User; token: string }> {
  // Find the passkey by credential ID
  const [passkeyRow] = await db
    .select()
    .from(passkeys)
    .where(eq(passkeys.credentialId, response.id))
    .limit(1);

  if (!passkeyRow) {
    throw new UnauthorizedError('Passkey not found');
  }

  // Retrieve and consume the challenge
  const challengeKey = `challenge:webauthn:${response.response.clientDataJSON}`;
  // The challenge is embedded in clientDataJSON, but we stored it by the challenge value.
  // Use the stored challenge from the options step.
  // In practice, the client sends back the challenge in the response, and we verify it matches.
  // SimpleWebAuthn handles this internally — we just need to pass expectedChallenge.

  // For discoverable credentials, retrieve challenge by looking up what we stored
  // Option A: Store challenge keyed by a session cookie / correlation ID
  // Option B: Verify the challenge exists in Redis (stored at generation time)
  // The simplest approach: store with known key and pass it to verification

  const credential: WebAuthnCredential = {
    id: passkeyRow.credentialId,
    publicKey: passkeyRow.publicKey,
    counter: passkeyRow.counter,
    transports: passkeyRow.transports as AuthenticatorTransportFuture[] | undefined,
  };

  const verification = await verifyAuthenticationResponse({
    response,
    expectedChallenge: (challenge: string) => {
      // Verify the challenge exists in Redis (it was stored during options generation)
      return redis.getdel(`challenge:webauthn:${challenge}`).then((v) => v !== null);
    },
    expectedOrigin: env.WEBAUTHN_ORIGIN,
    expectedRPID: env.WEBAUTHN_RP_ID,
    credential,
  });

  if (!verification.verified) {
    throw new UnauthorizedError('Passkey authentication failed');
  }

  // Update the counter (clone detection)
  const { newCounter } = verification.authenticationInfo;
  await db
    .update(passkeys)
    .set({ counter: newCounter })
    .where(eq(passkeys.id, passkeyRow.id));

  // Find the user
  const [userRow] = await db
    .select(userColumns)
    .from(users)
    .where(eq(users.id, passkeyRow.userId))
    .limit(1);

  if (!userRow) {
    throw new NotFoundError('User', passkeyRow.userId);
  }

  // Create a session (same as password login)
  const token = generateToken();
  const expiresAt = new Date(Date.now() + sessionTtlMs);

  await db.insert(sessions).values({
    token,
    userId: passkeyRow.userId,
    expiresAt,
    ipAddress: meta.ipAddress,
    userAgent: meta.userAgent,
  });

  // Cache session in Redis
  // ... (follow redis-integration skill pattern)

  return { user: mapToUser(userRow), token };
}
```

## Challenge Storage Strategy

For **registration** (user is authenticated):
- Key: `challenge:{userId}` — the user is known
- TTL: 300 seconds (5 minutes)
- Consumed via `GETDEL` on verification

For **authentication** (user is anonymous):
- Key: `challenge:webauthn:{challenge}` — keyed by the challenge value itself
- TTL: 300 seconds
- `expectedChallenge` accepts a function in SimpleWebAuthn v13 — use this to
  verify the challenge exists in Redis and delete it atomically

## Passkey Management

These are simpler CRUD operations for the account module:

```typescript
export async function listUserPasskeys(db: Database, userId: string): Promise<Passkey[]> {
  const rows = await db
    .select({
      id: passkeys.id,
      credentialId: passkeys.credentialId,
      deviceType: passkeys.deviceType,
      backedUp: passkeys.backedUp,
      name: passkeys.name,
      createdAt: passkeys.createdAt,
    })
    .from(passkeys)
    .where(eq(passkeys.userId, userId));

  return rows;
}

export async function renamePasskey(
  db: Database,
  passkeyId: string,
  userId: string,
  name: string,
): Promise<void> {
  const [row] = await db
    .update(passkeys)
    .set({ name })
    .where(and(eq(passkeys.id, passkeyId), eq(passkeys.userId, userId)))
    .returning({ id: passkeys.id });

  if (!row) {
    throw new NotFoundError('Passkey', passkeyId);
  }
}

export async function deletePasskey(
  db: Database,
  eventBus: EventBus,
  passkeyId: string,
  userId: string,
): Promise<void> {
  const [row] = await db
    .delete(passkeys)
    .where(and(eq(passkeys.id, passkeyId), eq(passkeys.userId, userId)))
    .returning({ id: passkeys.id });

  if (!row) {
    throw new NotFoundError('Passkey', passkeyId);
  }

  await eventBus.publish(createDomainEvent(PASSKEY_EVENTS.DELETED, { passkeyId }));
}
```

Management queries filter by `userId` to ensure users can only manage their own
passkeys (ownership verification at the query level, not just middleware).

## Types and Imports

Key types from `@simplewebauthn/server` v13:

```typescript
import type {
  AuthenticationResponseJSON,
  AuthenticatorTransportFuture,
  PublicKeyCredentialCreationOptionsJSON,
  PublicKeyCredentialRequestOptionsJSON,
  RegistrationResponseJSON,
  WebAuthnCredential,
} from '@simplewebauthn/server';
```

In v13, all types are exported directly from `@simplewebauthn/server` — the
separate `@simplewebauthn/types` package is retired.

## Testing WebAuthn

WebAuthn crypto operations require real browser authenticator interaction, which
can't be reproduced in Node.js tests. Mock the `@simplewebauthn/server` functions:

### Unit Tests

```typescript
vi.mock('@simplewebauthn/server', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@simplewebauthn/server')>();
  return {
    ...actual,
    generateRegistrationOptions: vi.fn(),
    verifyRegistrationResponse: vi.fn(),
    generateAuthenticationOptions: vi.fn(),
    verifyAuthenticationResponse: vi.fn(),
  };
});
```

### Mock Registration Flow

```typescript
import { generateRegistrationOptions, verifyRegistrationResponse } from '@simplewebauthn/server';

it('stores credential after successful registration', async () => {
  vi.mocked(generateRegistrationOptions).mockResolvedValue({
    challenge: 'test-challenge',
    // ... minimal required fields
  } as PublicKeyCredentialCreationOptionsJSON);

  vi.mocked(verifyRegistrationResponse).mockResolvedValue({
    verified: true,
    registrationInfo: {
      credential: {
        id: 'credential-id-base64url',
        publicKey: new Uint8Array([1, 2, 3, 4]),
        counter: 0,
        transports: ['internal'],
      },
      credentialDeviceType: 'multiDevice',
      credentialBackedUp: true,
    },
  } as VerifiedRegistrationResponse);

  // Call your service, assert credential was stored
});
```

### Integration Tests

In integration tests, mock `@simplewebauthn/server` at the module level (same
as unit tests) but use a real database and Redis. This verifies the storage and
cache flows work end-to-end while bypassing the cryptographic verification that
requires a real authenticator.

## Common Pitfalls

1. **Public key storage**: Must be stored as `bytea` (raw bytes). Don't base64-encode
   it before storing — the custom Drizzle type handles the Uint8Array ↔ Buffer conversion.
2. **Challenge consumption**: Always delete the challenge after use (GETDEL). Replayable
   challenges are a security vulnerability.
3. **Counter check**: SimpleWebAuthn handles counter verification internally during
   `verifyAuthenticationResponse`. Just update the stored counter after successful auth.
4. **Transports column**: Stored as `text[]` in PostgreSQL. Cast to
   `AuthenticatorTransportFuture[]` when passing to SimpleWebAuthn functions.
5. **Discoverable credentials**: For authentication, don't pass `allowCredentials` to
   `generateAuthenticationOptions` if you want the browser to show all available passkeys.

## Checklist

- [ ] `@simplewebauthn/server` installed
- [ ] WebAuthn env variables added (`WEBAUTHN_RP_NAME`, `WEBAUTHN_RP_ID`, `WEBAUTHN_ORIGIN`)
- [ ] Passkeys DB schema with `bytea` custom type for public key
- [ ] Registration options endpoint generates and stores challenge in Redis
- [ ] Registration verify endpoint consumes challenge and stores credential
- [ ] Authentication options endpoint generates challenge for anonymous flow
- [ ] Authentication verify endpoint validates credential and creates session
- [ ] Counter updated after each successful authentication
- [ ] Passkey management: list, rename, delete (with userId ownership check)
- [ ] `@simplewebauthn/server` mocked in unit and integration tests
- [ ] Challenge one-time use verified (GETDEL)
