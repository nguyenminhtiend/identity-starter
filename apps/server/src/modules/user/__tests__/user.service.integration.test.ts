import { ConflictError, NotFoundError } from '@identity-starter/core';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { type DomainEvent, InMemoryEventBus } from '../../../infra/event-bus.js';
import { createTestDb, type TestDb } from '../../../test/db-helper.js';
import { USER_EVENTS } from '../user.events.js';
import {
  createUser,
  findUserByEmail,
  findUserByEmailWithPassword,
  findUserById,
} from '../user.service.js';
import { makeCreateUserInput } from './user.factory.js';

let testDb: TestDb;
let eventBus: InMemoryEventBus;

beforeAll(async () => {
  testDb = await createTestDb();
});

afterAll(async () => {
  await testDb.teardown();
});

beforeEach(() => {
  eventBus = new InMemoryEventBus();
});

describe('createUser', () => {
  it('creates a user and returns it', async () => {
    const input = makeCreateUserInput();
    const user = await createUser(testDb.db, eventBus, input);

    expect(user.email).toBe(input.email);
    expect(user.displayName).toBe(input.displayName);
    expect(user.id).toBeDefined();
  });

  it('sets correct default values', async () => {
    const input = makeCreateUserInput();
    const user = await createUser(testDb.db, eventBus, input);

    expect(user.emailVerified).toBe(false);
    expect(user.status).toBe('pending_verification');
    expect(user.metadata).toEqual({});
    expect(user.createdAt).toBeInstanceOf(Date);
    expect(user.updatedAt).toBeInstanceOf(Date);
  });

  it('publishes USER_EVENTS.CREATED event', async () => {
    const input = makeCreateUserInput();
    const events: DomainEvent[] = [];
    eventBus.subscribe(USER_EVENTS.CREATED, (event) => {
      events.push(event);
    });

    await createUser(testDb.db, eventBus, input);

    expect(events).toHaveLength(1);
    expect(events[0].eventName).toBe(USER_EVENTS.CREATED);
    expect(events[0].payload).toHaveProperty('user');
  });

  it('throws ConflictError on duplicate email', async () => {
    const input = makeCreateUserInput();
    await createUser(testDb.db, eventBus, input);

    await expect(createUser(testDb.db, eventBus, input)).rejects.toThrow(ConflictError);
  });

  it('stores null passwordHash by default', async () => {
    const input = makeCreateUserInput();
    await createUser(testDb.db, eventBus, input);

    const user = await findUserByEmailWithPassword(testDb.db, input.email);
    expect(user.passwordHash).toBeNull();
  });

  it('stores custom metadata', async () => {
    const input = makeCreateUserInput({ metadata: { role: 'admin', tier: 'premium' } });
    const user = await createUser(testDb.db, eventBus, input);

    expect(user.metadata).toEqual({ role: 'admin', tier: 'premium' });
  });
});

describe('findUserById', () => {
  it('returns user when found', async () => {
    const input = makeCreateUserInput();
    const created = await createUser(testDb.db, eventBus, input);

    const user = await findUserById(testDb.db, created.id);

    expect(user.id).toBe(created.id);
    expect(user.email).toBe(input.email);
  });

  it('throws NotFoundError for non-existent id', async () => {
    await expect(findUserById(testDb.db, '00000000-0000-0000-0000-000000000000')).rejects.toThrow(
      NotFoundError,
    );
  });
});

describe('findUserByEmail', () => {
  it('returns user when found', async () => {
    const input = makeCreateUserInput();
    await createUser(testDb.db, eventBus, input);

    const user = await findUserByEmail(testDb.db, input.email);

    expect(user.email).toBe(input.email);
  });

  it('throws NotFoundError for non-existent email', async () => {
    await expect(findUserByEmail(testDb.db, 'nonexistent@test.com')).rejects.toThrow(NotFoundError);
  });
});
