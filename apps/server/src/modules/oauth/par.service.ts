import { randomBytes } from 'node:crypto';

import { ValidationError } from '@identity-starter/core';
import type { Database } from '@identity-starter/db';
import { parRequests } from '@identity-starter/db';
import { eq } from 'drizzle-orm';

export interface ParRequestParams {
  response_type: string;
  redirect_uri: string;
  scope: string;
  code_challenge: string;
  code_challenge_method: string;
  state?: string;
  nonce?: string;
}

export async function createParRequest(
  db: Database,
  clientInternalId: string,
  params: ParRequestParams,
  ttlSeconds: number,
): Promise<{ request_uri: string; expires_in: number }> {
  const requestUri = `urn:ietf:params:oauth:request_uri:${randomBytes(32).toString('base64url')}`;
  const expiresAt = new Date(Date.now() + ttlSeconds * 1000);

  await db.insert(parRequests).values({
    requestUri,
    clientId: clientInternalId,
    parameters: JSON.stringify(params),
    expiresAt,
  });

  return { request_uri: requestUri, expires_in: ttlSeconds };
}

export async function readParRequest(
  db: Database,
  requestUri: string,
  clientInternalId: string,
): Promise<{ id: string; params: ParRequestParams }> {
  const [row] = await db
    .select()
    .from(parRequests)
    .where(eq(parRequests.requestUri, requestUri))
    .limit(1);

  if (!row) {
    throw new ValidationError('Invalid request_uri', { request_uri: 'Not found' });
  }

  if (row.clientId !== clientInternalId) {
    throw new ValidationError('Invalid request_uri', { request_uri: 'Client mismatch' });
  }

  if (row.expiresAt.getTime() <= Date.now()) {
    throw new ValidationError('PAR request expired', { request_uri: 'Expired' });
  }

  if (row.usedAt !== null) {
    throw new ValidationError('PAR request already used', { request_uri: 'Already used' });
  }

  return { id: row.id, params: JSON.parse(row.parameters) as ParRequestParams };
}

export async function markParRequestUsed(db: Database, id: string): Promise<void> {
  await db.update(parRequests).set({ usedAt: new Date() }).where(eq(parRequests.id, id));
}
