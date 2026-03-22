import type { User } from './user.schemas.js';

export const USER_EVENTS = {
  CREATED: 'user.created',
  DELETED: 'user.deleted',
} as const;

export interface UserCreatedPayload {
  user: User;
}

export interface UserDeletedPayload {
  userId: string;
}
