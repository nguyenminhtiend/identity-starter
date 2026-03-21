import { ConflictError, NotFoundError } from '@identity-starter/core';
import type { Database } from '@identity-starter/db';
import { users } from '@identity-starter/db';
import { eq } from 'drizzle-orm';
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

export async function createUser(
  db: Database,
  eventBus: EventBus,
  input: CreateUserInput,
): Promise<User> {
  const existing = await findByEmailRow(db, input.email);
  if (existing) {
    throw new ConflictError('User', 'email', input.email);
  }

  const [row] = await db
    .insert(users)
    .values({
      email: input.email,
      displayName: input.displayName,
      passwordHash: input.passwordHash ?? null,
      metadata: input.metadata ?? {},
    })
    .returning();
  const user = mapToUser(row);
  await eventBus.publish(createDomainEvent(USER_EVENTS.CREATED, { user }));
  return user;
}

export async function findUserById(db: Database, id: string): Promise<User> {
  const [row] = await db.select().from(users).where(eq(users.id, id)).limit(1);
  if (!row) {
    throw new NotFoundError('User', id);
  }
  return mapToUser(row);
}

export async function findUserByEmail(db: Database, email: string): Promise<User> {
  const row = await findByEmailRow(db, email);
  if (!row) {
    throw new NotFoundError('User', email);
  }
  return mapToUser(row);
}

async function findByEmailRow(db: Database, email: string) {
  const [row] = await db.select().from(users).where(eq(users.email, email)).limit(1);
  return row ?? null;
}
