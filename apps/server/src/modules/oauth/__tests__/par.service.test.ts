import type { Database } from '@identity-starter/db';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createParRequest, type ParRequestParams, readParRequest } from '../par.service.js';

const randomBytesMock = vi.hoisted(() => vi.fn(() => Buffer.alloc(32, 7)));

vi.mock('node:crypto', () => ({
  randomBytes: randomBytesMock,
}));

describe('par.service', () => {
  const clientInternalId = '10000000-0000-7000-8000-000000000001';
  const params: ParRequestParams = {
    response_type: 'code',
    redirect_uri: 'https://example.com/callback',
    scope: 'openid profile',
    code_challenge: 'a'.repeat(43),
    code_challenge_method: 'S256',
    state: 's1',
    nonce: 'n1',
  };

  beforeEach(() => {
    randomBytesMock.mockReturnValue(Buffer.alloc(32, 7));
  });

  afterEach(() => {
    vi.clearAllMocks();
  });

  describe('createParRequest', () => {
    it('stores params and returns request_uri with urn prefix and expires_in', async () => {
      const insertValues = vi.fn().mockResolvedValue(undefined);
      const insert = vi.fn().mockReturnValue({ values: insertValues });
      const db = { insert } as unknown as Database;

      const result = await createParRequest(db, clientInternalId, params, 60);

      expect(result.expires_in).toBe(60);
      expect(result.request_uri.startsWith('urn:ietf:params:oauth:request_uri:')).toBe(true);
      expect(insert).toHaveBeenCalled();
      expect(insertValues).toHaveBeenCalledWith(
        expect.objectContaining({
          clientId: clientInternalId,
          parameters: JSON.stringify(params),
        }),
      );
      const arg = insertValues.mock.calls[0][0] as { requestUri: string; expiresAt: Date };
      expect(arg.expiresAt.getTime()).toBeGreaterThan(Date.now());
    });
  });

  describe('readParRequest', () => {
    // note: readParRequest no longer mutates; markParRequestUsed handles the write
    const rowId = '20000000-0000-7000-8000-000000000002';
    const requestUri = 'urn:ietf:params:oauth:request_uri:test';

    it('returns stored params parsed from JSON without mutating the row', async () => {
      const row = {
        id: rowId,
        requestUri,
        clientId: clientInternalId,
        parameters: JSON.stringify(params),
        expiresAt: new Date(Date.now() + 60_000),
        usedAt: null as Date | null,
        createdAt: new Date(),
      };

      const limit = vi.fn().mockResolvedValue([row]);
      const whereSelect = vi.fn().mockReturnValue({ limit });
      const from = vi.fn().mockReturnValue({ where: whereSelect });
      const select = vi.fn().mockReturnValue({ from });

      const update = vi.fn();
      const db = { select, update } as unknown as Database;

      const out = await readParRequest(db, requestUri, clientInternalId);

      expect(out).toEqual({ id: rowId, params });
      expect(update).not.toHaveBeenCalled();
    });

    it('throws when PAR is expired', async () => {
      const row = {
        id: rowId,
        requestUri,
        clientId: clientInternalId,
        parameters: JSON.stringify(params),
        expiresAt: new Date(Date.now() - 1000),
        usedAt: null as Date | null,
        createdAt: new Date(),
      };

      const limit = vi.fn().mockResolvedValue([row]);
      const whereSelect = vi.fn().mockReturnValue({ limit });
      const from = vi.fn().mockReturnValue({ where: whereSelect });
      const db = {
        select: vi.fn().mockReturnValue({ from }),
        update: vi.fn(),
      } as unknown as Database;

      await expect(readParRequest(db, requestUri, clientInternalId)).rejects.toMatchObject({
        message: 'PAR request expired',
      });
    });

    it('throws when PAR was already used', async () => {
      const row = {
        id: rowId,
        requestUri,
        clientId: clientInternalId,
        parameters: JSON.stringify(params),
        expiresAt: new Date(Date.now() + 60_000),
        usedAt: new Date(),
        createdAt: new Date(),
      };

      const limit = vi.fn().mockResolvedValue([row]);
      const whereSelect = vi.fn().mockReturnValue({ limit });
      const from = vi.fn().mockReturnValue({ where: whereSelect });
      const db = {
        select: vi.fn().mockReturnValue({ from }),
        update: vi.fn(),
      } as unknown as Database;

      await expect(readParRequest(db, requestUri, clientInternalId)).rejects.toMatchObject({
        message: 'PAR request already used',
      });
    });

    it('throws when client does not match', async () => {
      const row = {
        id: rowId,
        requestUri,
        clientId: clientInternalId,
        parameters: JSON.stringify(params),
        expiresAt: new Date(Date.now() + 60_000),
        usedAt: null as Date | null,
        createdAt: new Date(),
      };

      const limit = vi.fn().mockResolvedValue([row]);
      const whereSelect = vi.fn().mockReturnValue({ limit });
      const from = vi.fn().mockReturnValue({ where: whereSelect });
      const db = {
        select: vi.fn().mockReturnValue({ from }),
        update: vi.fn(),
      } as unknown as Database;

      await expect(
        readParRequest(db, requestUri, '99999999-9999-7999-8999-999999999999'),
      ).rejects.toMatchObject({
        message: 'Invalid request_uri',
      });
    });

    it('throws when request_uri is unknown', async () => {
      const limit = vi.fn().mockResolvedValue([]);
      const whereSelect = vi.fn().mockReturnValue({ limit });
      const from = vi.fn().mockReturnValue({ where: whereSelect });
      const db = {
        select: vi.fn().mockReturnValue({ from }),
        update: vi.fn(),
      } as unknown as Database;

      await expect(readParRequest(db, requestUri, clientInternalId)).rejects.toMatchObject({
        message: 'Invalid request_uri',
      });
    });
  });
});
