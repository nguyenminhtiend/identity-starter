import { ConflictError, err, NotFoundError, ok, type Result } from '@identity-starter/core';
import type { Database } from '@identity-starter/db';
import { users } from '@identity-starter/db';
import { eq } from 'drizzle-orm';
import { v7 as uuidv7 } from 'uuid';
import { createDomainEvent, type EventBus } from '../../infra/event-bus.js';
import { USER_EVENTS } from './user.events.js';
import type { CreateUserInput, User } from './user.schemas.js';

type UserRow = typeof users.$inferSelect;

function mapToUser(row: UserRow): User {
  return {
    id: row.id,
    email: row.email,
    emailVerified: row.emailVerified,
    passwordHash: row.passwordHash,
    displayName: row.displayName,
    status: row.status as User['status'],
    metadata: row.metadata as Record<string, unknown>,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
  };
}

export function stripPasswordHash(user: User) {
  const { passwordHash, ...rest } = user;
  return rest;
}

export interface UserService {
  create(input: CreateUserInput): Promise<Result<User, ConflictError>>;
  findById(id: string): Promise<Result<User, NotFoundError>>;
  findByEmail(email: string): Promise<Result<User, NotFoundError>>;
}

export function createUserService(db: Database, eventBus: EventBus): UserService {
  async function findByEmailRow(email: string) {
    const [row] = await db.select().from(users).where(eq(users.email, email)).limit(1);
    return row ?? null;
  }

  return {
    async create(input) {
      const existing = await findByEmailRow(input.email);
      if (existing) {
        return err(new ConflictError('User', 'email', input.email));
      }

      const [row] = await db
        .insert(users)
        .values({
          id: uuidv7(),
          email: input.email,
          displayName: input.displayName,
          passwordHash: input.passwordHash ?? null,
          metadata: input.metadata ?? {},
        })
        .returning();
      const user = mapToUser(row);
      await eventBus.publish(createDomainEvent(USER_EVENTS.CREATED, { user }));
      return ok(user);
    },

    async findById(id) {
      const [row] = await db.select().from(users).where(eq(users.id, id)).limit(1);
      if (!row) {
        return err(new NotFoundError('User', id));
      }
      return ok(mapToUser(row));
    },

    async findByEmail(email) {
      const row = await findByEmailRow(email);
      if (!row) {
        return err(new NotFoundError('User', email));
      }
      return ok(mapToUser(row));
    },
  };
}
