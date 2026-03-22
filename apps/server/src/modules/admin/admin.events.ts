export const ADMIN_EVENTS = {
  USER_SUSPENDED: 'admin.user_suspended',
  USER_ACTIVATED: 'admin.user_activated',
  SESSION_REVOKED: 'admin.session_revoked',
  SESSIONS_BULK_REVOKED: 'admin.sessions_bulk_revoked',
} as const;

export interface AdminUserSuspendedPayload {
  userId: string;
  adminId: string;
}

export interface AdminUserActivatedPayload {
  userId: string;
  adminId: string;
}

export interface AdminSessionRevokedPayload {
  sessionId: string;
  userId: string;
  adminId: string;
}

export interface AdminSessionsBulkRevokedPayload {
  userId: string;
  count: number;
  adminId: string;
}
