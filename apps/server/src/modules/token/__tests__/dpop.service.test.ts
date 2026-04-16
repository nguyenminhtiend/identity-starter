import { createHash, randomUUID } from 'node:crypto';
import { ValidationError } from '@identity-starter/core';
import * as jose from 'jose';
import { describe, expect, it } from 'vitest';
import { calculateJkt, validateDpopProof } from '../dpop.service.js';

function computeAthNode(accessToken: string): string {
  return createHash('sha256').update(accessToken, 'utf8').digest('base64url');
}

async function signDpopProof(options: {
  privateKey: jose.CryptoKey;
  publicJwk: jose.JWK;
  payload: Record<string, unknown>;
}): Promise<string> {
  const { privateKey, publicJwk, payload } = options;
  return new jose.SignJWT(payload)
    .setProtectedHeader({ alg: 'ES256', typ: 'dpop+jwt', jwk: publicJwk })
    .sign(privateKey);
}

describe('dpop.service', () => {
  describe('validateDpopProof', () => {
    it('valid proof returns jkt and publicKey', async () => {
      const { privateKey, publicKey } = await jose.generateKeyPair('ES256', { extractable: true });
      const publicJwk = await jose.exportJWK(publicKey);
      const htm = 'POST';
      const htu = 'https://server.example.com/oauth/token';
      const iat = Math.floor(Date.now() / 1000);
      const jti = randomUUID();
      const proofJwt = await signDpopProof({
        privateKey,
        publicJwk,
        payload: { jti, htm, htu, iat },
      });

      const result = await validateDpopProof(proofJwt, { htm, htu, maxAgeSeconds: 300 });

      expect(result.jkt).toBe(await jose.calculateJwkThumbprint(publicJwk, 'sha256'));
      await expect(jose.exportJWK(result.publicKey)).resolves.toMatchObject({
        kty: publicJwk.kty,
        crv: publicJwk.crv,
        x: publicJwk.x,
        y: publicJwk.y,
      });
    });

    it('throws ValidationError when signature is invalid', async () => {
      const { publicKey: pubA } = await jose.generateKeyPair('ES256', { extractable: true });
      const { privateKey: keyB } = await jose.generateKeyPair('ES256', { extractable: true });
      const publicJwkA = await jose.exportJWK(pubA);
      const htm = 'POST';
      const htu = 'https://server.example.com/oauth/token';
      const proofJwt = await signDpopProof({
        privateKey: keyB,
        publicJwk: publicJwkA,
        payload: {
          jti: randomUUID(),
          htm,
          htu,
          iat: Math.floor(Date.now() / 1000),
        },
      });

      await expect(validateDpopProof(proofJwt, { htm, htu })).rejects.toThrow(ValidationError);
    });

    it('throws ValidationError when required claims are missing', async () => {
      const { privateKey, publicKey } = await jose.generateKeyPair('ES256', { extractable: true });
      const publicJwk = await jose.exportJWK(publicKey);
      const htm = 'POST';
      const htu = 'https://server.example.com/oauth/token';
      const proofJwt = await signDpopProof({
        privateKey,
        publicJwk,
        payload: {
          htm,
          htu,
          iat: Math.floor(Date.now() / 1000),
          // missing jti
        },
      });

      await expect(validateDpopProof(proofJwt, { htm, htu })).rejects.toThrow(ValidationError);
    });

    it('throws ValidationError when htm does not match request method', async () => {
      const { privateKey, publicKey } = await jose.generateKeyPair('ES256', { extractable: true });
      const publicJwk = await jose.exportJWK(publicKey);
      const htu = 'https://server.example.com/oauth/token';
      const proofJwt = await signDpopProof({
        privateKey,
        publicJwk,
        payload: {
          jti: randomUUID(),
          htm: 'GET',
          htu,
          iat: Math.floor(Date.now() / 1000),
        },
      });

      await expect(
        validateDpopProof(proofJwt, { htm: 'POST', htu, maxAgeSeconds: 300 }),
      ).rejects.toThrow(ValidationError);
    });

    it('throws ValidationError when htu does not match request URL', async () => {
      const { privateKey, publicKey } = await jose.generateKeyPair('ES256', { extractable: true });
      const publicJwk = await jose.exportJWK(publicKey);
      const proofJwt = await signDpopProof({
        privateKey,
        publicJwk,
        payload: {
          jti: randomUUID(),
          htm: 'POST',
          htu: 'https://server.example.com/oauth/token',
          iat: Math.floor(Date.now() / 1000),
        },
      });

      await expect(
        validateDpopProof(proofJwt, {
          htm: 'POST',
          htu: 'https://other.example.com/oauth/token',
          maxAgeSeconds: 300,
        }),
      ).rejects.toThrow(ValidationError);
    });

    it('throws ValidationError when iat is too old', async () => {
      const { privateKey, publicKey } = await jose.generateKeyPair('ES256', { extractable: true });
      const publicJwk = await jose.exportJWK(publicKey);
      const htm = 'POST';
      const htu = 'https://server.example.com/oauth/token';
      const iat = Math.floor(Date.now() / 1000) - 400;
      const proofJwt = await signDpopProof({
        privateKey,
        publicJwk,
        payload: {
          jti: randomUUID(),
          htm,
          htu,
          iat,
        },
      });

      await expect(validateDpopProof(proofJwt, { htm, htu, maxAgeSeconds: 300 })).rejects.toThrow(
        ValidationError,
      );
    });

    it('validates ath when accessToken is provided', async () => {
      const { privateKey, publicKey } = await jose.generateKeyPair('ES256', { extractable: true });
      const publicJwk = await jose.exportJWK(publicKey);
      const htm = 'POST';
      const htu = 'https://rs.example.com/resource';
      const accessToken = 'header.payload.sig';
      const ath = computeAthNode(accessToken);
      const proofJwt = await signDpopProof({
        privateKey,
        publicJwk,
        payload: {
          jti: randomUUID(),
          htm,
          htu,
          iat: Math.floor(Date.now() / 1000),
          ath,
        },
      });

      const result = await validateDpopProof(proofJwt, {
        htm,
        htu,
        accessToken,
        maxAgeSeconds: 300,
      });

      expect(result.jkt).toBe(await jose.calculateJwkThumbprint(publicJwk, 'sha256'));
    });

    it('throws ValidationError when ath does not match access token hash', async () => {
      const { privateKey, publicKey } = await jose.generateKeyPair('ES256', { extractable: true });
      const publicJwk = await jose.exportJWK(publicKey);
      const htm = 'POST';
      const htu = 'https://rs.example.com/resource';
      const proofJwt = await signDpopProof({
        privateKey,
        publicJwk,
        payload: {
          jti: randomUUID(),
          htm,
          htu,
          iat: Math.floor(Date.now() / 1000),
          ath: computeAthNode('wrong-token'),
        },
      });

      await expect(
        validateDpopProof(proofJwt, {
          htm,
          htu,
          accessToken: 'correct-token',
          maxAgeSeconds: 300,
        }),
      ).rejects.toThrow(ValidationError);
    });
  });

  describe('calculateJkt', () => {
    it('computes JWK SHA-256 thumbprint per RFC 7638', async () => {
      const { publicKey } = await jose.generateKeyPair('ES256', { extractable: true });
      const publicJwk = await jose.exportJWK(publicKey);
      const expected = await jose.calculateJwkThumbprint(publicJwk, 'sha256');
      await expect(calculateJkt(publicJwk)).resolves.toBe(expected);
    });
  });
});
