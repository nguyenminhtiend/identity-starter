import type { User } from './user.types.js';

export const USER_EVENTS = {
  CREATED: 'user.created',
  UPDATED: 'user.updated',
  DELETED: 'user.deleted',
  SUSPENDED: 'user.suspended',
  ACTIVATED: 'user.activated',
  EMAIL_VERIFIED: 'user.email_verified',
} as const;

export interface UserCreatedPayload {
  user: User;
}

export interface UserUpdatedPayload {
  user: User;
  changes: Partial<User>;
}

export interface UserDeletedPayload {
  userId: string;
}

export interface UserSuspendedPayload {
  userId: string;
}

export interface UserActivatedPayload {
  userId: string;
}

export interface UserEmailVerifiedPayload {
  userId: string;
}
