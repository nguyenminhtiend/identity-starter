export const ACCOUNT_EVENTS = {
  PROFILE_UPDATED: 'account.profile_updated',
  SESSION_REVOKED: 'account.session_revoked',
  PASSKEY_RENAMED: 'account.passkey_renamed',
  PASSKEY_DELETED: 'account.passkey_deleted',
} as const;

export interface AccountProfileUpdatedPayload {
  userId: string;
}

export interface AccountSessionRevokedPayload {
  sessionId: string;
  userId: string;
}

export interface AccountPasskeyRenamedPayload {
  passkeyId: string;
  userId: string;
}

export interface AccountPasskeyDeletedPayload {
  passkeyId: string;
  userId: string;
}
