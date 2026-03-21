import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { type DomainEvent, InMemoryEventBus } from '../../../infra/event-bus.js';
import { createTestDb, type TestDb } from '../../../test/db-helper.js';
import { makeCreateUserInput } from '../../../test/factory.js';
import { USER_EVENTS } from '../user.events.js';
import { createUser, findUserByEmail, findUserById } from '../user.service.js';

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
  it('creates a user and returns ok result', async () => {
    const input = makeCreateUserInput();
    const result = await createUser(testDb.db, eventBus, input);

    expect(result.ok).toBe(true);
    if (!result.ok) {
      return;
    }
    expect(result.value.email).toBe(input.email);
    expect(result.value.displayName).toBe(input.displayName);
    expect(result.value.id).toBeDefined();
  });

  it('sets correct default values', async () => {
    const input = makeCreateUserInput();
    const result = await createUser(testDb.db, eventBus, input);

    expect(result.ok).toBe(true);
    if (!result.ok) {
      return;
    }
    expect(result.value.emailVerified).toBe(false);
    expect(result.value.status).toBe('pending_verification');
    expect(result.value.metadata).toEqual({});
    expect(result.value.createdAt).toBeInstanceOf(Date);
    expect(result.value.updatedAt).toBeInstanceOf(Date);
  });

  it('publishes USER_EVENTS.CREATED event', async () => {
    const input = makeCreateUserInput();
    const events: DomainEvent[] = [];
    eventBus.subscribe(USER_EVENTS.CREATED, (event) => {
      events.push(event);
    });

    const result = await createUser(testDb.db, eventBus, input);

    expect(result.ok).toBe(true);
    expect(events).toHaveLength(1);
    expect(events[0].eventName).toBe(USER_EVENTS.CREATED);
    expect(events[0].payload).toHaveProperty('user');
  });

  it('returns ConflictError on duplicate email', async () => {
    const input = makeCreateUserInput();
    await createUser(testDb.db, eventBus, input);

    const duplicateResult = await createUser(testDb.db, eventBus, input);

    expect(duplicateResult.ok).toBe(false);
    if (duplicateResult.ok) {
      return;
    }
    expect(duplicateResult.error.code).toBe('CONFLICT');
  });

  it('stores nullable passwordHash', async () => {
    const input = makeCreateUserInput({ passwordHash: null });
    const result = await createUser(testDb.db, eventBus, input);

    expect(result.ok).toBe(true);
    if (!result.ok) {
      return;
    }
    expect(result.value.passwordHash).toBeNull();
  });

  it('stores custom metadata', async () => {
    const input = makeCreateUserInput({ metadata: { role: 'admin', tier: 'premium' } });
    const result = await createUser(testDb.db, eventBus, input);

    expect(result.ok).toBe(true);
    if (!result.ok) {
      return;
    }
    expect(result.value.metadata).toEqual({ role: 'admin', tier: 'premium' });
  });
});

describe('findUserById', () => {
  it('returns ok with user when found', async () => {
    const input = makeCreateUserInput();
    const createResult = await createUser(testDb.db, eventBus, input);
    if (!createResult.ok) {
      throw new Error('Setup failed');
    }

    const result = await findUserById(testDb.db, createResult.value.id);

    expect(result.ok).toBe(true);
    if (!result.ok) {
      return;
    }
    expect(result.value.id).toBe(createResult.value.id);
    expect(result.value.email).toBe(input.email);
  });

  it('returns NotFoundError for non-existent id', async () => {
    const result = await findUserById(testDb.db, '00000000-0000-0000-0000-000000000000');

    expect(result.ok).toBe(false);
    if (result.ok) {
      return;
    }
    expect(result.error.code).toBe('NOT_FOUND');
  });
});

describe('findUserByEmail', () => {
  it('returns ok with user when found', async () => {
    const input = makeCreateUserInput();
    await createUser(testDb.db, eventBus, input);

    const result = await findUserByEmail(testDb.db, input.email);

    expect(result.ok).toBe(true);
    if (!result.ok) {
      return;
    }
    expect(result.value.email).toBe(input.email);
  });

  it('returns NotFoundError for non-existent email', async () => {
    const result = await findUserByEmail(testDb.db, 'nonexistent@test.com');

    expect(result.ok).toBe(false);
    if (result.ok) {
      return;
    }
    expect(result.error.code).toBe('NOT_FOUND');
  });
});
