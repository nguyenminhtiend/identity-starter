import crypto from 'node:crypto';
import { ConflictError, NotFoundError } from '@identity-starter/core';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { InMemoryEventBus } from '../../../infra/event-bus.js';
import { createMockDb } from '../../../test/mock-db.js';
import { CLIENT_EVENTS } from '../client.events.js';
import {
  authenticateClient,
  createClient,
  createClientService,
  deleteClient,
  getClient,
  getClientByClientId,
  listClients,
  rotateSecret,
  updateClient,
} from '../client.service.js';
import { buildCreateClientInput } from './client.factory.js';

const mockHashPassword = vi.fn();
const mockVerifyPassword = vi.fn();

vi.mock('../../../core/password.js', () => ({
  hashPassword: (...args: unknown[]) => mockHashPassword(...args),
  verifyPassword: (...args: unknown[]) => mockVerifyPassword(...args),
}));

function oauthClientRow(overrides: Record<string, unknown> = {}) {
  return {
    id: '550e8400-e29b-41d4-a716-446655440000',
    clientId: 'a1b2c3d4e5f6a7b8c9d0e1f2a3b4c5d',
    clientName: 'Test App',
    description: null,
    redirectUris: ['https://example.com/cb'],
    grantTypes: ['authorization_code'],
    responseTypes: ['code'],
    scope: 'openid',
    tokenEndpointAuthMethod: 'client_secret_basic',
    isConfidential: true,
    isFirstParty: false,
    logoUri: null,
    tosUri: null,
    policyUri: null,
    applicationType: 'web',
    status: 'active',
    createdAt: new Date('2024-01-01T00:00:00.000Z'),
    updatedAt: new Date('2024-01-02T00:00:00.000Z'),
    ...overrides,
  };
}

describe('createClient', () => {
  beforeEach(() => {
    vi.spyOn(crypto, 'randomBytes').mockImplementation((size: number) => Buffer.alloc(size, 0xab));
    mockHashPassword.mockImplementation((plain: string) => Promise.resolve(`hashed:${plain}`));
  });

  afterEach(() => {
    vi.restoreAllMocks();
    mockHashPassword.mockReset();
  });

  it('generates clientId, hashes secret, inserts, returns client and plaintext secret', async () => {
    const returning = vi.fn();
    const values = vi.fn().mockReturnValue({ returning });
    const insert = vi.fn().mockReturnValue({ values });
    const db = createMockDb({ insert });
    const eventBus = new InMemoryEventBus();
    const publishSpy = vi.spyOn(eventBus, 'publish');

    const input = buildCreateClientInput();
    const rowWithName = oauthClientRow({
      clientId: 'abababababababababababababababab',
      clientName: input.clientName,
    });
    returning.mockResolvedValue([rowWithName]);

    const result = await createClient(db, eventBus, input);

    expect(insert).toHaveBeenCalled();
    expect(values).toHaveBeenCalled();
    const inserted = values.mock.calls[0][0] as { clientId: string; clientSecretHash: string };
    expect(inserted.clientId).toBe('abababababababababababababababab');
    expect(inserted.clientSecretHash).toMatch(/^hashed:/);
    expect(mockHashPassword).toHaveBeenCalledTimes(1);

    expect(result.id).toBe(rowWithName.id);
    expect(result.clientId).toBe(rowWithName.clientId);
    expect(result.clientSecret).toBeDefined();
    expect(result.clientSecret.length).toBeGreaterThan(0);
    expect(result.clientName).toBe(input.clientName);

    expect(publishSpy).toHaveBeenCalledTimes(1);
    const evt = publishSpy.mock.calls[0][0];
    expect(evt.eventName).toBe(CLIENT_EVENTS.CREATED);
    expect(evt.payload).toEqual({ id: rowWithName.id, clientId: rowWithName.clientId });
  });

  it('throws ConflictError on unique violation for clientId', async () => {
    const err = new Error('duplicate');
    (err as unknown as { code: string }).code = '23505';
    const returning = vi.fn().mockRejectedValue(err);
    const values = vi.fn().mockReturnValue({ returning });
    const insert = vi.fn().mockReturnValue({ values });
    const db = createMockDb({ insert });
    const eventBus = new InMemoryEventBus();

    await expect(createClient(db, eventBus, buildCreateClientInput())).rejects.toThrow(
      ConflictError,
    );
  });
});

describe('listClients', () => {
  it('returns all clients without secret hash', async () => {
    const r1 = oauthClientRow({ id: '11111111-1111-1111-1111-111111111111', clientId: 'aaa' });
    const r2 = oauthClientRow({ id: '22222222-2222-2222-2222-222222222222', clientId: 'bbb' });
    const from = vi.fn().mockResolvedValue([r1, r2]);
    const db = createMockDb({
      select: vi.fn().mockReturnValue({ from }),
    });

    const list = await listClients(db);
    expect(list).toHaveLength(2);
    expect(list[0]).not.toHaveProperty('clientSecretHash');
    expect(list[0].clientId).toBe('aaa');
  });
});

describe('getClient', () => {
  it('returns client by id', async () => {
    const row = oauthClientRow();
    const limit = vi.fn().mockResolvedValue([row]);
    const where = vi.fn().mockReturnValue({ limit });
    const from = vi.fn().mockReturnValue({ where });
    const db = createMockDb({
      select: vi.fn().mockReturnValue({ from }),
    });

    const client = await getClient(db, row.id);
    expect(client.id).toBe(row.id);
    expect(client.clientId).toBe(row.clientId);
  });

  it('throws NotFoundError if missing', async () => {
    const limit = vi.fn().mockResolvedValue([]);
    const where = vi.fn().mockReturnValue({ limit });
    const from = vi.fn().mockReturnValue({ where });
    const db = createMockDb({
      select: vi.fn().mockReturnValue({ from }),
    });

    await expect(getClient(db, '00000000-0000-0000-0000-000000000000')).rejects.toThrow(
      NotFoundError,
    );
  });
});

describe('getClientByClientId', () => {
  it('returns client by oauth client_id string', async () => {
    const row = oauthClientRow({ clientId: 'public-oauth-id' });
    const limit = vi.fn().mockResolvedValue([row]);
    const where = vi.fn().mockReturnValue({ limit });
    const from = vi.fn().mockReturnValue({ where });
    const db = createMockDb({
      select: vi.fn().mockReturnValue({ from }),
    });

    const client = await getClientByClientId(db, 'public-oauth-id');
    expect(client.clientId).toBe('public-oauth-id');
    expect(client.id).toBe(row.id);
  });

  it('throws NotFoundError if missing', async () => {
    const limit = vi.fn().mockResolvedValue([]);
    const where = vi.fn().mockReturnValue({ limit });
    const from = vi.fn().mockReturnValue({ where });
    const db = createMockDb({
      select: vi.fn().mockReturnValue({ from }),
    });

    await expect(getClientByClientId(db, 'missing')).rejects.toThrow(NotFoundError);
  });
});

describe('updateClient', () => {
  it('updates allowed fields', async () => {
    const updated = oauthClientRow({ clientName: 'New Name' });
    const returning = vi.fn().mockResolvedValue([updated]);
    const where = vi.fn().mockReturnValue({ returning });
    const set = vi.fn().mockReturnValue({ where });
    const update = vi.fn().mockReturnValue({ set });
    const db = createMockDb({ update });
    const eventBus = new InMemoryEventBus();
    const publishSpy = vi.spyOn(eventBus, 'publish');

    const result = await updateClient(db, eventBus, updated.id, { clientName: 'New Name' });

    expect(result.clientName).toBe('New Name');
    expect(set).toHaveBeenCalled();
    expect(publishSpy).toHaveBeenCalledTimes(1);
    expect(publishSpy.mock.calls[0][0].eventName).toBe(CLIENT_EVENTS.UPDATED);
  });

  it('throws NotFoundError if missing', async () => {
    const returning = vi.fn().mockResolvedValue([]);
    const where = vi.fn().mockReturnValue({ returning });
    const set = vi.fn().mockReturnValue({ where });
    const update = vi.fn().mockReturnValue({ set });
    const db = createMockDb({ update });
    const eventBus = new InMemoryEventBus();

    await expect(
      updateClient(db, eventBus, '00000000-0000-0000-0000-000000000000', { clientName: 'X' }),
    ).rejects.toThrow(NotFoundError);
  });
});

describe('deleteClient', () => {
  it('deletes client', async () => {
    const returning = vi.fn().mockResolvedValue([{ id: '550e8400-e29b-41d4-a716-446655440000' }]);
    const where = vi.fn().mockReturnValue({ returning });
    const del = vi.fn().mockReturnValue({ where });
    const db = createMockDb({ delete: del });
    const eventBus = new InMemoryEventBus();
    const publishSpy = vi.spyOn(eventBus, 'publish');

    await deleteClient(db, eventBus, '550e8400-e29b-41d4-a716-446655440000');

    expect(del).toHaveBeenCalled();
    expect(publishSpy).toHaveBeenCalledTimes(1);
    expect(publishSpy.mock.calls[0][0].eventName).toBe(CLIENT_EVENTS.DELETED);
  });

  it('throws NotFoundError if missing', async () => {
    const returning = vi.fn().mockResolvedValue([]);
    const where = vi.fn().mockReturnValue({ returning });
    const del = vi.fn().mockReturnValue({ where });
    const db = createMockDb({ delete: del });
    const eventBus = new InMemoryEventBus();

    await expect(
      deleteClient(db, eventBus, '00000000-0000-0000-0000-000000000000'),
    ).rejects.toThrow(NotFoundError);
  });
});

describe('rotateSecret', () => {
  beforeEach(() => {
    vi.spyOn(crypto, 'randomBytes').mockImplementation((size: number) => Buffer.alloc(size, 0xcd));
    mockHashPassword.mockImplementation((plain: string) => Promise.resolve(`rotated:${plain}`));
  });

  afterEach(() => {
    vi.restoreAllMocks();
    mockHashPassword.mockReset();
  });

  it('generates new secret, hashes, updates row, returns plaintext secret', async () => {
    const row = oauthClientRow();
    const returning = vi.fn().mockResolvedValue([row]);
    const where = vi.fn().mockReturnValue({ returning });
    const set = vi.fn().mockReturnValue({ where });
    const update = vi.fn().mockReturnValue({ set });
    const db = createMockDb({ update });
    const eventBus = new InMemoryEventBus();
    const publishSpy = vi.spyOn(eventBus, 'publish');

    const { clientSecret } = await rotateSecret(db, eventBus, row.id);

    expect(clientSecret).toBeDefined();
    expect(mockHashPassword).toHaveBeenCalledWith(clientSecret);
    expect(set).toHaveBeenCalled();
    const patch = set.mock.calls[0][0] as { clientSecretHash: string };
    expect(patch.clientSecretHash).toMatch(/^rotated:/);

    expect(publishSpy).toHaveBeenCalledTimes(1);
    expect(publishSpy.mock.calls[0][0].eventName).toBe(CLIENT_EVENTS.SECRET_ROTATED);
  });

  it('throws NotFoundError if missing', async () => {
    const returning = vi.fn().mockResolvedValue([]);
    const where = vi.fn().mockReturnValue({ returning });
    const set = vi.fn().mockReturnValue({ where });
    const update = vi.fn().mockReturnValue({ set });
    const db = createMockDb({ update });
    const eventBus = new InMemoryEventBus();

    await expect(
      rotateSecret(db, eventBus, '00000000-0000-0000-0000-000000000000'),
    ).rejects.toThrow(NotFoundError);
  });
});

describe('authenticateClient', () => {
  beforeEach(() => {
    mockVerifyPassword.mockReset();
  });

  it('returns null when client is missing', async () => {
    const limit = vi.fn().mockResolvedValue([]);
    const where = vi.fn().mockReturnValue({ limit });
    const from = vi.fn().mockReturnValue({ where });
    const db = createMockDb({
      select: vi.fn().mockReturnValue({ from }),
    });

    await expect(authenticateClient(db, 'missing', 'secret')).resolves.toBeNull();
    expect(mockVerifyPassword).not.toHaveBeenCalled();
  });

  it('returns null for tokenEndpointAuthMethod none', async () => {
    const row = oauthClientRow({
      tokenEndpointAuthMethod: 'none',
      clientSecretHash: 'hash',
    });
    const limit = vi.fn().mockResolvedValue([row]);
    const where = vi.fn().mockReturnValue({ limit });
    const from = vi.fn().mockReturnValue({ where });
    const db = createMockDb({
      select: vi.fn().mockReturnValue({ from }),
    });

    await expect(authenticateClient(db, row.clientId, 'any')).resolves.toBeNull();
    expect(mockVerifyPassword).not.toHaveBeenCalled();
  });

  it('returns null when secret is invalid (client_secret_basic client)', async () => {
    const row = oauthClientRow({
      tokenEndpointAuthMethod: 'client_secret_basic',
      clientSecretHash: 'stored-hash',
    });
    mockVerifyPassword.mockResolvedValue(false);
    const limit = vi.fn().mockResolvedValue([row]);
    const where = vi.fn().mockReturnValue({ limit });
    const from = vi.fn().mockReturnValue({ where });
    const db = createMockDb({
      select: vi.fn().mockReturnValue({ from }),
    });

    await expect(authenticateClient(db, row.clientId, 'wrong')).resolves.toBeNull();
    expect(mockVerifyPassword).toHaveBeenCalledWith('stored-hash', 'wrong');
  });

  it('returns client when secret is valid for client_secret_basic', async () => {
    const row = oauthClientRow({
      tokenEndpointAuthMethod: 'client_secret_basic',
      clientSecretHash: 'stored-hash',
    });
    mockVerifyPassword.mockResolvedValue(true);
    const limit = vi.fn().mockResolvedValue([row]);
    const where = vi.fn().mockReturnValue({ limit });
    const from = vi.fn().mockReturnValue({ where });
    const db = createMockDb({
      select: vi.fn().mockReturnValue({ from }),
    });

    const client = await authenticateClient(db, row.clientId, 'good');
    expect(client).not.toBeNull();
    expect(client?.clientId).toBe(row.clientId);
    expect(client).not.toHaveProperty('clientSecretHash');
  });

  it('returns client when secret is valid for client_secret_post', async () => {
    const row = oauthClientRow({
      tokenEndpointAuthMethod: 'client_secret_post',
      clientSecretHash: 'stored-hash',
    });
    mockVerifyPassword.mockResolvedValue(true);
    const limit = vi.fn().mockResolvedValue([row]);
    const where = vi.fn().mockReturnValue({ limit });
    const from = vi.fn().mockReturnValue({ where });
    const db = createMockDb({
      select: vi.fn().mockReturnValue({ from }),
    });

    const client = await authenticateClient(db, row.clientId, 'posted-secret');
    expect(client).not.toBeNull();
    expect(mockVerifyPassword).toHaveBeenCalledWith('stored-hash', 'posted-secret');
  });
});

describe('createClientService', () => {
  it('delegates to underlying functions', () => {
    const row = oauthClientRow();
    const limit = vi.fn().mockResolvedValue([row]);
    const where = vi.fn().mockReturnValue({ limit });
    const from = vi.fn().mockReturnValue({ where });
    const db = createMockDb({
      select: vi.fn().mockReturnValue({ from }),
    });
    const eventBus = new InMemoryEventBus();

    const svc = createClientService({ db, eventBus });
    expect(typeof svc.createClient).toBe('function');
    expect(typeof svc.listClients).toBe('function');
    expect(typeof svc.getClient).toBe('function');
    expect(typeof svc.updateClient).toBe('function');
    expect(typeof svc.deleteClient).toBe('function');
    expect(typeof svc.rotateSecret).toBe('function');
    expect(typeof svc.authenticateClient).toBe('function');
    expect(typeof svc.getClientByClientId).toBe('function');
  });
});
