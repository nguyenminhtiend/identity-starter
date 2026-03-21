import type { User } from './user.types.js';

export type UserEvents = {
  'user.created': { user: User };
  'user.updated': { user: User; changes: Partial<User> };
  'user.deleted': { userId: string };
  'user.suspended': { userId: string };
  'user.activated': { userId: string };
  'user.email_verified': { userId: string };
};
