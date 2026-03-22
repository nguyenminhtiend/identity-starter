import type { Database } from '@identity-starter/db';
import * as jose from 'jose';
import { describe, expect, it, vi } from 'vitest';
import { createSigningKeyService } from '../signing-key.service.js';

function mockSelectChain(rows: unknown[]) {
  const limit = vi.fn().mockResolvedValue(rows);
  const orderBy = vi.fn().mockReturnValue({ limit });
  const where = vi.fn().mockReturnValue({ orderBy });
  const from = vi.fn().mockReturnValue({ where });
  const select = vi.fn().mockReturnValue({ from });
  return { select, limit, orderBy, where, from };
}

function mockSelectChainJwks(rows: unknown[]) {
  const orderBy = vi.fn().mockResolvedValue(rows);
  const where = vi.fn().mockReturnValue({ orderBy });
  const from = vi.fn().mockReturnValue({ where });
  const select = vi.fn().mockReturnValue({ from });
  return { select };
}

describe('createSigningKeyService', () => {
  describe('generateKeyPair', () => {
    it('generates RSA 2048-bit key pair and returns JWK with kid', async () => {
      let inserted: Record<string, unknown> | undefined;
      const returning = vi.fn().mockImplementation(() => {
        return Promise.resolve([
          {
            id: '00000000-0000-7000-8000-000000000001',
            kid: inserted?.kid,
            algorithm: 'RS256',
            publicKeyJwk: inserted?.publicKeyJwk,
            privateKeyJwk: inserted?.privateKeyJwk,
            status: 'active',
            expiresAt: null,
            createdAt: new Date('2026-01-01T00:00:00.000Z'),
          },
        ]);
      });
      const values = vi.fn().mockImplementation((v: Record<string, unknown>) => {
        inserted = v;
        return { returning };
      });
      const db = {
        insert: vi.fn().mockReturnValue({ values }),
      } as unknown as Database;

      const service = createSigningKeyService({ db });
      const result = await service.generateKeyPair();

      expect(db.insert).toHaveBeenCalled();
      expect(inserted?.algorithm).toBe('RS256');
      expect(inserted?.status).toBe('active');
      expect(typeof result.kid).toBe('string');
      expect(result.kid).toMatch(
        /^[0-9a-f]{8}-[0-9a-f]{4}-7[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i,
      );
      expect(result.publicKeyJwk.kty).toBe('RSA');
      expect(result.publicKeyJwk.kid).toBe(result.kid);
      expect(result.privateKeyJwk.kty).toBe('RSA');
      expect(result.privateKeyJwk.kid).toBe(result.kid);
      const n = Buffer.from(jose.base64url.decode(result.publicKeyJwk.n as string));
      expect(n.length).toBe(256);
      expect(result.privateKey).toBeInstanceOf(CryptoKey);
    });
  });

  describe('getActiveSigningKey', () => {
    it('returns the most recently created active key', async () => {
      const { publicKey, privateKey } = await jose.generateKeyPair('RS256', { extractable: true });
      const publicKeyJwk = await jose.exportJWK(publicKey);
      const privateKeyJwk = await jose.exportJWK(privateKey);
      const kid = '00000000-0000-7000-8000-000000000099';
      publicKeyJwk.kid = kid;
      privateKeyJwk.kid = kid;

      const row = {
        id: '00000000-0000-7000-8000-000000000001',
        kid,
        algorithm: 'RS256',
        publicKeyJwk,
        privateKeyJwk,
        status: 'active',
        expiresAt: null,
        createdAt: new Date(),
      };

      const { select } = mockSelectChain([row]);
      const db = {
        select,
        insert: vi.fn(),
      } as unknown as Database;

      const service = createSigningKeyService({ db });
      const result = await service.getActiveSigningKey();

      expect(result.kid).toBe(kid);
      expect(result.publicKeyJwk).toEqual(publicKeyJwk);
      expect(result.privateKey).toBeInstanceOf(CryptoKey);
      expect(db.insert).not.toHaveBeenCalled();
    });

    it('generates a key when no active key exists', async () => {
      const { select } = mockSelectChain([]);
      let inserted: Record<string, unknown> | undefined;
      const returning = vi.fn().mockImplementation(() => {
        return Promise.resolve([
          {
            id: '00000000-0000-7000-8000-000000000001',
            kid: inserted?.kid,
            algorithm: 'RS256',
            publicKeyJwk: inserted?.publicKeyJwk,
            privateKeyJwk: inserted?.privateKeyJwk,
            status: 'active',
            expiresAt: null,
            createdAt: new Date('2026-01-01T00:00:00.000Z'),
          },
        ]);
      });
      const values = vi.fn().mockImplementation((v: Record<string, unknown>) => {
        inserted = v;
        return { returning };
      });
      const db = {
        select,
        insert: vi.fn().mockReturnValue({ values }),
      } as unknown as Database;

      const service = createSigningKeyService({ db });
      const result = await service.getActiveSigningKey();

      expect(db.insert).toHaveBeenCalled();
      expect(result.kid).toBe(inserted?.kid);
      expect(result.privateKey).toBeInstanceOf(CryptoKey);
    });

    it('reuses cached CryptoKey on second call', async () => {
      const { publicKey, privateKey } = await jose.generateKeyPair('RS256', { extractable: true });
      const publicKeyJwk = await jose.exportJWK(publicKey);
      const privateKeyJwk = await jose.exportJWK(privateKey);
      const kid = '00000000-0000-7000-8000-000000000088';
      publicKeyJwk.kid = kid;
      privateKeyJwk.kid = kid;

      const row = {
        id: '00000000-0000-7000-8000-000000000001',
        kid,
        algorithm: 'RS256',
        publicKeyJwk,
        privateKeyJwk,
        status: 'active',
        expiresAt: null,
        createdAt: new Date(),
      };

      const limit = vi.fn().mockResolvedValue([row]);
      const orderBy = vi.fn().mockReturnValue({ limit });
      const where = vi.fn().mockReturnValue({ orderBy });
      const from = vi.fn().mockReturnValue({ where });
      const select = vi.fn().mockReturnValue({ from });

      const db = {
        select,
        insert: vi.fn(),
      } as unknown as Database;

      const service = createSigningKeyService({ db });
      const first = await service.getActiveSigningKey();
      const second = await service.getActiveSigningKey();

      expect(select).toHaveBeenCalledTimes(2);
      expect(second.privateKey).toBe(first.privateKey);
    });
  });

  describe('getJwks', () => {
    it('returns active and rotated keys as JWKS with kid, alg, and use', async () => {
      const { publicKey: pub1 } = await jose.generateKeyPair('RS256');
      const { publicKey: pub2 } = await jose.generateKeyPair('RS256');
      const jwk1 = await jose.exportJWK(pub1);
      const jwk2 = await jose.exportJWK(pub2);
      jwk1.kid = '00000000-0000-7000-8000-000000000001';
      jwk2.kid = '00000000-0000-7000-8000-000000000002';

      const rows = [
        { kid: jwk2.kid as string, algorithm: 'RS256', publicKeyJwk: jwk2 },
        { kid: jwk1.kid as string, algorithm: 'RS256', publicKeyJwk: jwk1 },
      ];

      const { select } = mockSelectChainJwks(rows);
      const db = { select } as unknown as Database;

      const service = createSigningKeyService({ db });
      const jwks = await service.getJwks();

      expect(jwks.keys).toHaveLength(2);
      for (const k of jwks.keys) {
        expect(k.use).toBe('sig');
        expect(k.alg).toBe('RS256');
        expect(k.kid).toBeDefined();
        expect(k.kty).toBe('RSA');
      }
    });
  });

  describe('rotateKey', () => {
    it('marks active keys as rotated and inserts a new active key', async () => {
      const updateWhere = vi.fn().mockResolvedValue(undefined);
      const updateSet = vi.fn().mockReturnValue({ where: updateWhere });
      const update = vi.fn().mockReturnValue({ set: updateSet });

      let inserted: Record<string, unknown> | undefined;
      const returning = vi.fn().mockImplementation(() => {
        return Promise.resolve([
          {
            id: '00000000-0000-7000-8000-000000000003',
            kid: inserted?.kid,
            algorithm: 'RS256',
            publicKeyJwk: inserted?.publicKeyJwk,
            privateKeyJwk: inserted?.privateKeyJwk,
            status: 'active',
            expiresAt: null,
            createdAt: new Date('2026-01-01T00:00:00.000Z'),
          },
        ]);
      });
      const values = vi.fn().mockImplementation((v: Record<string, unknown>) => {
        inserted = v;
        return { returning };
      });
      const insert = vi.fn().mockReturnValue({ values });

      const db = {
        update,
        insert,
      } as unknown as Database;

      const service = createSigningKeyService({ db });
      await service.rotateKey();

      expect(update).toHaveBeenCalled();
      expect(updateSet).toHaveBeenCalledWith({ status: 'rotated' });
      expect(insert).toHaveBeenCalled();
      expect(inserted?.status).toBe('active');
    });
  });
});
