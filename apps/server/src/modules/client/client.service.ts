import crypto from 'node:crypto';
import { ConflictError, NotFoundError } from '@identity-starter/core';
import type { Database } from '@identity-starter/db';
import { oauthClientColumns, oauthClients } from '@identity-starter/db';
import { eq } from 'drizzle-orm';
import { isUniqueViolation } from '../../core/db-utils.js';
import { hashPassword, verifyPassword } from '../../core/password.js';
import { createDomainEvent, type EventBus } from '../../infra/event-bus.js';
import { CLIENT_EVENTS } from './client.events.js';
import type {
  ClientResponse,
  ClientWithSecretResponse,
  CreateClientInput,
  UpdateClientInput,
} from './client.schemas.js';

type SafeRow = typeof oauthClientColumns;
type SafeRowResult = { [K in keyof SafeRow]: SafeRow[K]['_']['data'] };

export function mapToClientResponse(row: SafeRowResult): ClientResponse {
  return {
    id: row.id,
    clientId: row.clientId,
    clientName: row.clientName,
    description: row.description ?? null,
    redirectUris: row.redirectUris,
    grantTypes: row.grantTypes as ClientResponse['grantTypes'],
    responseTypes: row.responseTypes as ClientResponse['responseTypes'],
    scope: row.scope,
    tokenEndpointAuthMethod:
      row.tokenEndpointAuthMethod as ClientResponse['tokenEndpointAuthMethod'],
    isConfidential: row.isConfidential,
    isFirstParty: row.isFirstParty,
    logoUri: row.logoUri ?? null,
    tosUri: row.tosUri ?? null,
    policyUri: row.policyUri ?? null,
    applicationType: row.applicationType as ClientResponse['applicationType'],
    status: row.status as ClientResponse['status'],
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
  };
}

export async function createClient(
  db: Database,
  eventBus: EventBus,
  input: CreateClientInput,
): Promise<ClientWithSecretResponse> {
  const clientId = crypto.randomBytes(16).toString('hex');
  const clientSecret = crypto.randomBytes(32).toString('base64url');
  const clientSecretHash = await hashPassword(clientSecret);

  let row: SafeRowResult;
  try {
    [row] = await db
      .insert(oauthClients)
      .values({
        clientId,
        clientSecretHash,
        clientName: input.clientName,
        description: null,
        redirectUris: input.redirectUris,
        grantTypes: input.grantTypes,
        responseTypes: ['code'],
        scope: input.scope,
        tokenEndpointAuthMethod: input.tokenEndpointAuthMethod,
        isConfidential: input.isConfidential,
        isFirstParty: input.isFirstParty ?? false,
        logoUri: null,
        tosUri: null,
        policyUri: null,
      })
      .returning(oauthClientColumns);
  } catch (error) {
    if (isUniqueViolation(error)) {
      throw new ConflictError('OAuth client', 'clientId', clientId);
    }
    throw error;
  }

  await eventBus.publish(
    createDomainEvent(CLIENT_EVENTS.CREATED, { id: row.id, clientId: row.clientId }),
  );

  return {
    ...mapToClientResponse(row),
    clientSecret,
  };
}

export async function listClients(db: Database): Promise<ClientResponse[]> {
  const rows = await db.select(oauthClientColumns).from(oauthClients);
  return rows.map((r) => mapToClientResponse(r));
}

export async function getClient(db: Database, id: string): Promise<ClientResponse> {
  const [row] = await db
    .select(oauthClientColumns)
    .from(oauthClients)
    .where(eq(oauthClients.id, id))
    .limit(1);
  if (!row) {
    throw new NotFoundError('Client', id);
  }
  return mapToClientResponse(row);
}

export async function getClientByClientId(db: Database, clientId: string): Promise<ClientResponse> {
  const [row] = await db
    .select(oauthClientColumns)
    .from(oauthClients)
    .where(eq(oauthClients.clientId, clientId))
    .limit(1);
  if (!row) {
    throw new NotFoundError('Client', clientId);
  }
  return mapToClientResponse(row);
}

export async function updateClient(
  db: Database,
  eventBus: EventBus,
  id: string,
  input: UpdateClientInput,
): Promise<ClientResponse> {
  const patch: Partial<typeof oauthClients.$inferInsert> = {};
  if (input.clientName !== undefined) {
    patch.clientName = input.clientName;
  }
  if (input.redirectUris !== undefined) {
    patch.redirectUris = input.redirectUris;
  }
  if (input.grantTypes !== undefined) {
    patch.grantTypes = input.grantTypes;
  }
  if (input.scope !== undefined) {
    patch.scope = input.scope;
  }
  if (input.tokenEndpointAuthMethod !== undefined) {
    patch.tokenEndpointAuthMethod = input.tokenEndpointAuthMethod;
  }
  if (input.isConfidential !== undefined) {
    patch.isConfidential = input.isConfidential;
  }
  if (input.isFirstParty !== undefined) {
    patch.isFirstParty = input.isFirstParty;
  }

  if (Object.keys(patch).length === 0) {
    return getClient(db, id);
  }

  patch.updatedAt = new Date();

  const [row] = await db
    .update(oauthClients)
    .set(patch)
    .where(eq(oauthClients.id, id))
    .returning(oauthClientColumns);

  if (!row) {
    throw new NotFoundError('Client', id);
  }

  await eventBus.publish(createDomainEvent(CLIENT_EVENTS.UPDATED, { id: row.id }));

  return mapToClientResponse(row);
}

export async function deleteClient(db: Database, eventBus: EventBus, id: string): Promise<void> {
  const [row] = await db.delete(oauthClients).where(eq(oauthClients.id, id)).returning({
    id: oauthClients.id,
  });
  if (!row) {
    throw new NotFoundError('Client', id);
  }
  await eventBus.publish(createDomainEvent(CLIENT_EVENTS.DELETED, { id: row.id }));
}

export async function rotateSecret(
  db: Database,
  eventBus: EventBus,
  id: string,
): Promise<{ clientSecret: string }> {
  const clientSecret = crypto.randomBytes(32).toString('base64url');
  const clientSecretHash = await hashPassword(clientSecret);

  const [row] = await db
    .update(oauthClients)
    .set({ clientSecretHash, updatedAt: new Date() })
    .where(eq(oauthClients.id, id))
    .returning(oauthClientColumns);

  if (!row) {
    throw new NotFoundError('Client', id);
  }

  await eventBus.publish(createDomainEvent(CLIENT_EVENTS.SECRET_ROTATED, { id: row.id }));

  return { clientSecret };
}

export async function authenticateClient(
  db: Database,
  clientId: string,
  clientSecret: string,
): Promise<ClientResponse | null> {
  const [row] = await db
    .select()
    .from(oauthClients)
    .where(eq(oauthClients.clientId, clientId))
    .limit(1);

  if (!row) {
    return null;
  }

  if (row.tokenEndpointAuthMethod === 'none') {
    return null;
  }

  const valid = await verifyPassword(row.clientSecretHash, clientSecret);
  if (!valid) {
    return null;
  }

  return mapToClientResponse(row as SafeRowResult);
}

export interface ClientServiceDeps {
  db: Database;
  eventBus: EventBus;
}

export function createClientService(deps: ClientServiceDeps) {
  const { db, eventBus } = deps;
  return {
    createClient: (input: CreateClientInput) => createClient(db, eventBus, input),
    listClients: () => listClients(db),
    getClient: (id: string) => getClient(db, id),
    updateClient: (id: string, input: UpdateClientInput) => updateClient(db, eventBus, id, input),
    deleteClient: (id: string) => deleteClient(db, eventBus, id),
    rotateSecret: (id: string) => rotateSecret(db, eventBus, id),
    authenticateClient: (clientId: string, clientSecret: string) =>
      authenticateClient(db, clientId, clientSecret),
    getClientByClientId: (clientId: string) => getClientByClientId(db, clientId),
  };
}

export type ClientService = ReturnType<typeof createClientService>;
