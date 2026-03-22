export const PASSKEY_EVENTS = {
  REGISTERED: 'passkey.registered',
  DELETED: 'passkey.deleted',
} as const;

export interface PasskeyRegisteredPayload {
  passkeyId: string;
  userId: string;
}

export interface PasskeyDeletedPayload {
  passkeyId: string;
  userId: string;
}
