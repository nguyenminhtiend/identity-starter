import crypto from 'node:crypto';
import { ConflictError, NotFoundError } from '@identity-starter/core';
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { type DomainEvent, InMemoryEventBus } from '../../../infra/event-bus.js';
import { createTestDb, type TestDb } from '../../../test/db-helper.js';
import { CLIENT_EVENTS } from '../client.events.js';
import {
  authenticateClient,
  createClient,
  deleteClient,
  getClient,
  getClientByClientId,
  listClients,
  rotateSecret,
  updateClient,
} from '../client.service.js';
import { buildCreateClientInput } from './client.factory.js';

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

describe('client.service integration', () => {
  it('full CRUD lifecycle', async () => {
    const input = buildCreateClientInput({ clientName: 'Lifecycle App' });
    const created = await createClient(testDb.db, eventBus, input);

    expect(created.clientSecret).toBeDefined();
    expect(created.clientName).toBe('Lifecycle App');

    const byId = await getClient(testDb.db, created.id);
    expect(byId.clientId).toBe(created.clientId);

    const byClientId = await getClientByClientId(testDb.db, created.clientId);
    expect(byClientId.id).toBe(created.id);

    const updated = await updateClient(testDb.db, eventBus, created.id, {
      clientName: 'Updated Name',
    });
    expect(updated.clientName).toBe('Updated Name');

    const list = await listClients(testDb.db);
    expect(list.some((c) => c.id === created.id)).toBe(true);

    await deleteClient(testDb.db, eventBus, created.id);

    await expect(getClient(testDb.db, created.id)).rejects.toThrow(NotFoundError);
  });

  it('publishes domain events for lifecycle', async () => {
    const events: DomainEvent[] = [];
    for (const name of Object.values(CLIENT_EVENTS)) {
      eventBus.subscribe(name, (e) => {
        events.push(e);
      });
    }

    const created = await createClient(testDb.db, eventBus, buildCreateClientInput());
    await updateClient(testDb.db, eventBus, created.id, { scope: 'openid email' });
    await rotateSecret(testDb.db, eventBus, created.id);
    await deleteClient(testDb.db, eventBus, created.id);

    const names = events.map((e) => e.eventName);
    expect(names).toContain(CLIENT_EVENTS.CREATED);
    expect(names).toContain(CLIENT_EVENTS.UPDATED);
    expect(names).toContain(CLIENT_EVENTS.SECRET_ROTATED);
    expect(names).toContain(CLIENT_EVENTS.DELETED);
  });

  it('secret rotation: old secret fails, new works', async () => {
    const created = await createClient(testDb.db, eventBus, buildCreateClientInput());
    const oldSecret = created.clientSecret;

    expect(await authenticateClient(testDb.db, created.clientId, oldSecret)).not.toBeNull();

    const { clientSecret: newSecret } = await rotateSecret(testDb.db, eventBus, created.id);
    expect(newSecret).not.toBe(oldSecret);

    expect(await authenticateClient(testDb.db, created.clientId, oldSecret)).toBeNull();
    expect(await authenticateClient(testDb.db, created.clientId, newSecret)).not.toBeNull();
  });

  it('throws ConflictError when clientId collides on create', async () => {
    const spy = vi.spyOn(crypto, 'randomBytes').mockImplementation((size: number) => {
      return Buffer.alloc(size, 0x77);
    });
    try {
      await createClient(testDb.db, eventBus, buildCreateClientInput());
      await expect(createClient(testDb.db, eventBus, buildCreateClientInput())).rejects.toThrow(
        ConflictError,
      );
    } finally {
      spy.mockRestore();
    }
  });

  it('authenticateClient accepts correct secret and rejects wrong', async () => {
    const created = await createClient(
      testDb.db,
      eventBus,
      buildCreateClientInput({ tokenEndpointAuthMethod: 'client_secret_post' }),
    );

    const ok = await authenticateClient(testDb.db, created.clientId, created.clientSecret);
    expect(ok?.id).toBe(created.id);

    expect(await authenticateClient(testDb.db, created.clientId, 'wrong')).toBeNull();
  });

  it('getClient and getClientByClientId throw when missing', async () => {
    await expect(getClient(testDb.db, '00000000-0000-0000-0000-000000000000')).rejects.toThrow(
      NotFoundError,
    );
    await expect(getClientByClientId(testDb.db, 'nonexistent-client-id')).rejects.toThrow(
      NotFoundError,
    );
  });
});
