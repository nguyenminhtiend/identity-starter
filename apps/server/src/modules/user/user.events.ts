import type { User } from './user.schemas.js';

export const USER_EVENTS = {
  CREATED: 'user.created',
} as const;

export interface UserCreatedPayload {
  user: User;
}
