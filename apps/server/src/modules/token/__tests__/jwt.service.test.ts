import { createHash } from 'node:crypto';
import * as jose from 'jose';
import { v7 as uuidv7 } from 'uuid';
import { beforeAll, describe, expect, it } from 'vitest';
import {
  computeAtHash,
  issueAccessToken,
  issueIdToken,
  verifyAccessToken,
} from '../jwt.service.js';
import type { ActiveSigningKeyResult } from '../signing-key.service.js';

describe('jwt.service', () => {
  let signingKey: ActiveSigningKeyResult;

  beforeAll(async () => {
    const { publicKey, privateKey } = await jose.generateKeyPair('RS256', { extractable: true });
    const kid = uuidv7();
    const publicKeyJwk = await jose.exportJWK(publicKey);
    publicKeyJwk.kid = kid;
    publicKeyJwk.alg = 'RS256';
    publicKeyJwk.use = 'sig';
    signingKey = { kid, privateKey, publicKeyJwk };
  });

  describe('issueAccessToken', () => {
    it('returns a JWT with iss, sub, aud, exp, iat, jti, scope, and client_id', async () => {
      const issuer = 'https://id.example.com';
      const subject = 'user-123';
      const audience = 'api.example.com';
      const scope = 'openid profile email';
      const clientId = 'client-abc';
      const expiresInSeconds = 3600;

      const token = await issueAccessToken(signingKey, {
        issuer,
        subject,
        audience,
        scope,
        clientId,
        expiresInSeconds,
      });

      const jwks = jose.createLocalJWKSet({ keys: [signingKey.publicKeyJwk] });
      const { payload, protectedHeader } = await jose.jwtVerify(token, jwks, {
        issuer,
        algorithms: ['RS256'],
      });

      expect(protectedHeader.alg).toBe('RS256');
      expect(protectedHeader.kid).toBe(signingKey.kid);
      expect(payload.iss).toBe(issuer);
      expect(payload.sub).toBe(subject);
      expect(payload.aud).toBe(audience);
      expect(typeof payload.iat).toBe('number');
      expect(typeof payload.exp).toBe('number');
      expect(payload.exp).toBe((payload.iat as number) + expiresInSeconds);
      expect(payload.jti).toMatch(
        /^[0-9a-f]{8}-[0-9a-f]{4}-7[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i,
      );
      expect(payload.scope).toBe(scope);
      expect(payload.client_id).toBe(clientId);
    });
  });

  describe('issueIdToken', () => {
    it('returns a JWT with OIDC claims including at_hash, auth_time, acr, amr, nonce, sid', async () => {
      const issuer = 'https://id.example.com';
      const subject = 'user-456';
      const audience = 'client-xyz';
      const nonce = 'n-once-value';
      const authTime = Math.floor(Date.now() / 1000) - 120;
      const acr = 'urn:mace:incommon:iap:silver';
      const amr = ['pwd', 'mfa'];
      const sessionId = 'sess-789';
      const expiresInSeconds = 600;

      const accessToken = await issueAccessToken(signingKey, {
        issuer,
        subject,
        audience: 'resource-server',
        scope: 'openid',
        clientId: audience,
        expiresInSeconds: 3600,
      });

      const idToken = await issueIdToken(signingKey, {
        issuer,
        subject,
        audience,
        nonce,
        authTime,
        acr,
        amr,
        accessToken,
        expiresInSeconds,
        sessionId,
      });

      const jwks = jose.createLocalJWKSet({ keys: [signingKey.publicKeyJwk] });
      const { payload, protectedHeader } = await jose.jwtVerify(idToken, jwks, {
        issuer,
        algorithms: ['RS256'],
      });

      expect(protectedHeader.kid).toBe(signingKey.kid);
      expect(payload.iss).toBe(issuer);
      expect(payload.sub).toBe(subject);
      expect(payload.aud).toBe(audience);
      expect(typeof payload.iat).toBe('number');
      expect(typeof payload.exp).toBe('number');
      expect(payload.exp).toBe((payload.iat as number) + expiresInSeconds);
      expect(payload.nonce).toBe(nonce);
      expect(payload.auth_time).toBe(authTime);
      expect(payload.acr).toBe(acr);
      expect(payload.amr).toEqual(amr);
      expect(payload.at_hash).toBe(computeAtHash(accessToken));
      expect(payload.sid).toBe(sessionId);
    });

    it('omits nonce and sid when not provided', async () => {
      const issuer = 'https://id.example.com';
      const subject = 'user-789';
      const audience = 'client-no-opt';
      const accessToken = await issueAccessToken(signingKey, {
        issuer,
        subject,
        audience: 'rs',
        scope: 'openid',
        clientId: audience,
        expiresInSeconds: 3600,
      });

      const idToken = await issueIdToken(signingKey, {
        issuer,
        subject,
        audience,
        authTime: Math.floor(Date.now() / 1000),
        acr: '0',
        amr: ['pwd'],
        accessToken,
        expiresInSeconds: 300,
      });

      const jwks = jose.createLocalJWKSet({ keys: [signingKey.publicKeyJwk] });
      const { payload } = await jose.jwtVerify(idToken, jwks, {
        issuer,
        algorithms: ['RS256'],
      });

      expect(payload).not.toHaveProperty('nonce');
      expect(payload).not.toHaveProperty('sid');
    });
  });

  describe('verifyAccessToken', () => {
    it('validates signature, expiry, and issuer', async () => {
      const issuer = 'https://id.example.com';
      const token = await issueAccessToken(signingKey, {
        issuer,
        subject: 'sub-v',
        audience: 'aud-v',
        scope: 'read',
        clientId: 'cid-v',
        expiresInSeconds: 3600,
      });

      const jwks = jose.createLocalJWKSet({ keys: [signingKey.publicKeyJwk] });
      const result = await verifyAccessToken(jwks, token, issuer);

      expect(result).not.toBeNull();
      if (result) {
        expect(result.payload.sub).toBe('sub-v');
        expect(result.protectedHeader.kid).toBe(signingKey.kid);
      }
    });

    it('returns null for an expired token', async () => {
      const issuer = 'https://id.example.com';
      const iat = Math.floor(Date.now() / 1000) - 10_000;
      const exp = iat + 60;

      const token = await new jose.SignJWT({
        scope: 'x',
        client_id: 'c',
        jti: uuidv7(),
      })
        .setProtectedHeader({ alg: 'RS256', kid: signingKey.kid })
        .setIssuer(issuer)
        .setSubject('sub')
        .setAudience('aud')
        .setIssuedAt(iat)
        .setExpirationTime(exp)
        .sign(signingKey.privateKey);

      const jwks = jose.createLocalJWKSet({ keys: [signingKey.publicKeyJwk] });
      const result = await verifyAccessToken(jwks, token, issuer);

      expect(result).toBeNull();
    });

    it('returns null when issuer does not match', async () => {
      const token = await issueAccessToken(signingKey, {
        issuer: 'https://issuer-a.example.com',
        subject: 's',
        audience: 'a',
        scope: 's',
        clientId: 'c',
        expiresInSeconds: 3600,
      });

      const jwks = jose.createLocalJWKSet({ keys: [signingKey.publicKeyJwk] });
      const result = await verifyAccessToken(jwks, token, 'https://issuer-b.example.com');

      expect(result).toBeNull();
    });
  });

  describe('computeAtHash', () => {
    it('returns SHA-256 left half of the access token, base64url encoded', () => {
      const accessToken = 'test-access-token-value';
      const expected = computeAtHash(accessToken);

      const hash = createHash('sha256').update(accessToken).digest();
      const leftHalf = hash.subarray(0, hash.length / 2);
      expect(expected).toBe(jose.base64url.encode(leftHalf));
    });
  });

  describe('JWT header kid', () => {
    it('uses kid from the active signing key in the JWT header', async () => {
      const token = await issueAccessToken(signingKey, {
        issuer: 'https://id.example.com',
        subject: 'u',
        audience: 'a',
        scope: 'openid',
        clientId: 'c',
        expiresInSeconds: 300,
      });

      const header = jose.decodeProtectedHeader(token);
      expect(header.kid).toBe(signingKey.kid);
      expect(header.alg).toBe('RS256');
    });
  });
});
