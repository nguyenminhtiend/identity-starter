import type { Database } from '@identity-starter/db';
import type { DomainEvent, EventBus } from '../../infra/event-bus.js';
import { ACCOUNT_EVENTS } from '../account/account.events.js';
import { ADMIN_EVENTS } from '../admin/admin.events.js';
import { AUTH_EVENTS } from '../auth/auth.events.js';
import { CLIENT_EVENTS } from '../client/client.events.js';
import { MFA_EVENTS } from '../mfa/mfa.events.js';
import { OAUTH_EVENTS } from '../oauth/oauth.events.js';
import { PASSKEY_EVENTS } from '../passkey/passkey.events.js';
import { RBAC_EVENTS } from '../rbac/rbac.events.js';
import { SESSION_EVENTS } from '../session/session.events.js';
import { USER_EVENTS } from '../user/user.events.js';
import { anonymizeActorInAuditLogs, createAuditLog } from './audit.service.js';

interface EventMapping {
  eventName: string;
  resourceType: string;
  extractActorId: (payload: Record<string, unknown>) => string | null;
  extractResourceId: (payload: Record<string, unknown>) => string | null;
}

const EVENT_MAPPINGS: EventMapping[] = [
  {
    eventName: AUTH_EVENTS.REGISTERED,
    resourceType: 'user',
    extractActorId: (p) => (p.userId as string) ?? null,
    extractResourceId: (p) => (p.userId as string) ?? null,
  },
  {
    eventName: AUTH_EVENTS.LOGIN,
    resourceType: 'session',
    extractActorId: (p) => (p.userId as string) ?? null,
    extractResourceId: (p) => (p.userId as string) ?? null,
  },
  {
    eventName: AUTH_EVENTS.LOGOUT,
    resourceType: 'session',
    extractActorId: (p) => (p.userId as string) ?? null,
    extractResourceId: (p) => (p.sessionId as string) ?? null,
  },
  {
    eventName: AUTH_EVENTS.FAILED_LOGIN,
    resourceType: 'auth',
    extractActorId: () => null,
    extractResourceId: () => null,
  },
  {
    eventName: AUTH_EVENTS.PASSWORD_CHANGED,
    resourceType: 'user',
    extractActorId: (p) => (p.userId as string) ?? null,
    extractResourceId: (p) => (p.userId as string) ?? null,
  },
  {
    eventName: AUTH_EVENTS.EMAIL_VERIFIED,
    resourceType: 'user',
    extractActorId: (p) => (p.userId as string) ?? null,
    extractResourceId: (p) => (p.userId as string) ?? null,
  },
  {
    eventName: AUTH_EVENTS.PASSWORD_RESET_REQUESTED,
    resourceType: 'user',
    extractActorId: (p) => (p.userId as string) ?? null,
    extractResourceId: (p) => (p.userId as string) ?? null,
  },
  {
    eventName: AUTH_EVENTS.PASSWORD_RESET_COMPLETED,
    resourceType: 'user',
    extractActorId: (p) => (p.userId as string) ?? null,
    extractResourceId: (p) => (p.userId as string) ?? null,
  },
  {
    eventName: SESSION_EVENTS.CREATED,
    resourceType: 'session',
    extractActorId: (p) => {
      const session = p.session as Record<string, unknown> | undefined;
      return (session?.userId as string) ?? null;
    },
    extractResourceId: (p) => {
      const session = p.session as Record<string, unknown> | undefined;
      return (session?.id as string) ?? null;
    },
  },
  {
    eventName: SESSION_EVENTS.REVOKED,
    resourceType: 'session',
    extractActorId: (p) => (p.userId as string) ?? null,
    extractResourceId: (p) => (p.sessionId as string) ?? null,
  },
  {
    eventName: ADMIN_EVENTS.USER_SUSPENDED,
    resourceType: 'user',
    extractActorId: (p) => (p.adminId as string) ?? null,
    extractResourceId: (p) => (p.userId as string) ?? null,
  },
  {
    eventName: ADMIN_EVENTS.USER_ACTIVATED,
    resourceType: 'user',
    extractActorId: (p) => (p.adminId as string) ?? null,
    extractResourceId: (p) => (p.userId as string) ?? null,
  },
  {
    eventName: ADMIN_EVENTS.SESSION_REVOKED,
    resourceType: 'session',
    extractActorId: (p) => (p.adminId as string) ?? null,
    extractResourceId: (p) => (p.sessionId as string) ?? null,
  },
  {
    eventName: ADMIN_EVENTS.SESSIONS_BULK_REVOKED,
    resourceType: 'session',
    extractActorId: (p) => (p.adminId as string) ?? null,
    extractResourceId: (p) => (p.userId as string) ?? null,
  },
  {
    eventName: RBAC_EVENTS.ROLE_CREATED,
    resourceType: 'role',
    extractActorId: () => null,
    extractResourceId: (p) => (p.roleId as string) ?? null,
  },
  {
    eventName: RBAC_EVENTS.ROLE_UPDATED,
    resourceType: 'role',
    extractActorId: () => null,
    extractResourceId: (p) => (p.roleId as string) ?? null,
  },
  {
    eventName: RBAC_EVENTS.ROLE_ASSIGNED,
    resourceType: 'user_role',
    extractActorId: (p) => (p.assignedBy as string) ?? null,
    extractResourceId: (p) => (p.userId as string) ?? null,
  },
  {
    eventName: RBAC_EVENTS.ROLE_REMOVED,
    resourceType: 'user_role',
    extractActorId: (p) => (p.removedBy as string) ?? null,
    extractResourceId: (p) => (p.userId as string) ?? null,
  },
  {
    eventName: ACCOUNT_EVENTS.PROFILE_UPDATED,
    resourceType: 'user',
    extractActorId: (p) => (p.userId as string) ?? null,
    extractResourceId: (p) => (p.userId as string) ?? null,
  },
  {
    eventName: ACCOUNT_EVENTS.SESSION_REVOKED,
    resourceType: 'session',
    extractActorId: (p) => (p.userId as string) ?? null,
    extractResourceId: (p) => (p.sessionId as string) ?? null,
  },
  {
    eventName: ACCOUNT_EVENTS.PASSKEY_RENAMED,
    resourceType: 'passkey',
    extractActorId: (p) => (p.userId as string) ?? null,
    extractResourceId: (p) => (p.passkeyId as string) ?? null,
  },
  {
    eventName: ACCOUNT_EVENTS.PASSKEY_DELETED,
    resourceType: 'passkey',
    extractActorId: (p) => (p.userId as string) ?? null,
    extractResourceId: (p) => (p.passkeyId as string) ?? null,
  },
  {
    eventName: MFA_EVENTS.TOTP_ENROLLED,
    resourceType: 'mfa',
    extractActorId: (p) => (p.userId as string) ?? null,
    extractResourceId: (p) => (p.userId as string) ?? null,
  },
  {
    eventName: MFA_EVENTS.TOTP_DISABLED,
    resourceType: 'mfa',
    extractActorId: (p) => (p.userId as string) ?? null,
    extractResourceId: (p) => (p.userId as string) ?? null,
  },
  {
    eventName: MFA_EVENTS.TOTP_VERIFIED,
    resourceType: 'mfa',
    extractActorId: (p) => (p.userId as string) ?? null,
    extractResourceId: (p) => (p.userId as string) ?? null,
  },
  {
    eventName: MFA_EVENTS.RECOVERY_CODES_GENERATED,
    resourceType: 'mfa',
    extractActorId: (p) => (p.userId as string) ?? null,
    extractResourceId: (p) => (p.userId as string) ?? null,
  },
  {
    eventName: MFA_EVENTS.RECOVERY_CODE_USED,
    resourceType: 'mfa',
    extractActorId: (p) => (p.userId as string) ?? null,
    extractResourceId: (p) => (p.userId as string) ?? null,
  },
  {
    eventName: PASSKEY_EVENTS.REGISTERED,
    resourceType: 'passkey',
    extractActorId: (p) => (p.userId as string) ?? null,
    extractResourceId: (p) => (p.passkeyId as string) ?? null,
  },
  {
    eventName: PASSKEY_EVENTS.DELETED,
    resourceType: 'passkey',
    extractActorId: (p) => (p.userId as string) ?? null,
    extractResourceId: (p) => (p.passkeyId as string) ?? null,
  },
  {
    eventName: OAUTH_EVENTS.AUTHORIZATION_CODE_ISSUED,
    resourceType: 'oauth',
    extractActorId: (p) => (p.userId as string) ?? null,
    extractResourceId: (p) => (p.clientId as string) ?? null,
  },
  {
    eventName: OAUTH_EVENTS.TOKEN_EXCHANGED,
    resourceType: 'oauth',
    extractActorId: (p) => (p.userId as string) ?? null,
    extractResourceId: (p) => (p.clientId as string) ?? null,
  },
  {
    eventName: OAUTH_EVENTS.CONSENT_GRANTED,
    resourceType: 'consent',
    extractActorId: (p) => (p.userId as string) ?? null,
    extractResourceId: (p) => (p.clientId as string) ?? null,
  },
  {
    eventName: OAUTH_EVENTS.CONSENT_REVOKED,
    resourceType: 'consent',
    extractActorId: (p) => (p.userId as string) ?? null,
    extractResourceId: (p) => (p.clientId as string) ?? null,
  },
  {
    eventName: CLIENT_EVENTS.CREATED,
    resourceType: 'client',
    extractActorId: () => null,
    extractResourceId: (p) => (p.id as string) ?? null,
  },
  {
    eventName: CLIENT_EVENTS.UPDATED,
    resourceType: 'client',
    extractActorId: () => null,
    extractResourceId: (p) => (p.id as string) ?? null,
  },
  {
    eventName: CLIENT_EVENTS.DELETED,
    resourceType: 'client',
    extractActorId: () => null,
    extractResourceId: (p) => (p.id as string) ?? null,
  },
  {
    eventName: CLIENT_EVENTS.SECRET_ROTATED,
    resourceType: 'client',
    extractActorId: () => null,
    extractResourceId: (p) => (p.id as string) ?? null,
  },
];

export function registerAuditListener(db: Database, eventBus: EventBus): void {
  for (const mapping of EVENT_MAPPINGS) {
    eventBus.subscribe(mapping.eventName, async (event: DomainEvent) => {
      const payload = event.payload as Record<string, unknown>;
      await createAuditLog(db, {
        actorId: mapping.extractActorId(payload),
        action: event.eventName,
        resourceType: mapping.resourceType,
        resourceId: mapping.extractResourceId(payload),
        details: payload,
      });
    });
  }

  // GDPR: anonymize actor_id when a user is deleted (pre-wired for future user deletion feature)
  eventBus.subscribe(USER_EVENTS.DELETED, async (event: DomainEvent) => {
    const payload = event.payload as { userId: string };
    await anonymizeActorInAuditLogs(db, payload.userId);
  });
}
