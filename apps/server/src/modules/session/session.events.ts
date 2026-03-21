import type { Session } from './session.schemas.js';

export const SESSION_EVENTS = {
  CREATED: 'session.created',
  REVOKED: 'session.revoked',
} as const;

export interface SessionCreatedPayload {
  session: Session;
}

export interface SessionRevokedPayload {
  sessionId: string;
  userId: string;
}
