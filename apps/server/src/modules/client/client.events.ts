export const CLIENT_EVENTS = {
  CREATED: 'client.created',
  UPDATED: 'client.updated',
  DELETED: 'client.deleted',
  SECRET_ROTATED: 'client.secret_rotated',
} as const;

export interface ClientCreatedPayload {
  id: string;
  clientId: string;
}

export interface ClientUpdatedPayload {
  id: string;
}

export interface ClientDeletedPayload {
  id: string;
}

export interface ClientSecretRotatedPayload {
  id: string;
}
