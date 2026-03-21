import { ConflictError, NotFoundError } from '@identity-starter/core';
import type { Database } from '@identity-starter/db';
import { userColumns, users } from '@identity-starter/db';
import { eq } from 'drizzle-orm';
import { createDomainEvent, type EventBus } from '../../infra/event-bus.js';
import { USER_EVENTS } from './user.events.js';
import type { CreateUserInput, User, UserWithPassword } from './user.schemas.js';

type SafeRow = typeof userColumns;
type SafeRowResult = { [K in keyof SafeRow]: SafeRow[K]['_']['data'] };

function mapToUser(row: SafeRowResult): User {
  return {
    id: row.id,
    email: row.email,
    emailVerified: row.emailVerified,
    displayName: row.displayName,
    status: row.status as User['status'],
    metadata: row.metadata as Record<string, unknown>,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
  };
}

type FullRow = typeof users.$inferSelect;

function mapToUserWithPassword(row: FullRow): UserWithPassword {
  return {
    ...mapToUser(row),
    passwordHash: row.passwordHash,
  };
}

function isUniqueViolation(error: unknown): boolean {
  if (!(error instanceof Error)) {
    return false;
  }
  const pgCode = (error as { code?: string }).code;
  if (pgCode === '23505') {
    return true;
  }
  const cause = (error as { cause?: { code?: string } }).cause;
  return cause?.code === '23505';
}

export async function createUser(
  db: Database,
  eventBus: EventBus,
  input: CreateUserInput,
): Promise<User> {
  let row: SafeRowResult;
  try {
    [row] = await db
      .insert(users)
      .values({
        email: input.email,
        displayName: input.displayName,
        metadata: input.metadata ?? {},
      })
      .returning(userColumns);
  } catch (error) {
    if (isUniqueViolation(error)) {
      throw new ConflictError('User', 'email', input.email);
    }
    throw error;
  }

  const user = mapToUser(row);
  await eventBus.publish(createDomainEvent(USER_EVENTS.CREATED, { user }));
  return user;
}

export async function findUserById(db: Database, id: string): Promise<User> {
  const [row] = await db.select(userColumns).from(users).where(eq(users.id, id)).limit(1);
  if (!row) {
    throw new NotFoundError('User', id);
  }
  return mapToUser(row);
}

export async function findUserByEmail(db: Database, email: string): Promise<User> {
  const [row] = await db.select(userColumns).from(users).where(eq(users.email, email)).limit(1);
  if (!row) {
    throw new NotFoundError('User', email);
  }
  return mapToUser(row);
}

export async function findUserByEmailWithPassword(
  db: Database,
  email: string,
): Promise<UserWithPassword> {
  const [row] = await db.select().from(users).where(eq(users.email, email)).limit(1);
  if (!row) {
    throw new NotFoundError('User', email);
  }
  return mapToUserWithPassword(row);
}

export interface UserServiceDeps {
  db: Database;
  eventBus: EventBus;
}

export function createUserService(deps: UserServiceDeps) {
  const { db, eventBus } = deps;
  return {
    create: (input: CreateUserInput) => createUser(db, eventBus, input),
    findById: (id: string) => findUserById(db, id),
    findByEmail: (email: string) => findUserByEmail(db, email),
    findByEmailWithPassword: (email: string) => findUserByEmailWithPassword(db, email),
  };
}

export type UserService = ReturnType<typeof createUserService>;
