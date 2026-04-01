// e2e/src/helpers/dpop.ts
import { createHash, randomUUID } from 'node:crypto';
import * as jose from 'jose';

export interface DPoPKeyPair {
  privateKey: CryptoKey;
  publicJwk: jose.JWK;
}

export async function generateDPoPKeyPair(): Promise<DPoPKeyPair> {
  const { privateKey, publicKey } = await jose.generateKeyPair('ES256');
  const publicJwk = await jose.exportJWK(publicKey);
  return { privateKey, publicJwk };
}

export async function createDPoPProof(
  keyPair: DPoPKeyPair,
  method: string,
  url: string,
  accessToken?: string,
): Promise<string> {
  const header: jose.JWTHeaderParameters = {
    typ: 'dpop+jwt',
    alg: 'ES256',
    jwk: keyPair.publicJwk,
  };

  const payload: jose.JWTPayload = {
    jti: randomUUID(),
    htm: method,
    htu: url,
    iat: Math.floor(Date.now() / 1000),
  };

  if (accessToken) {
    const hash = createHash('sha256').update(accessToken).digest('base64url');
    payload.ath = hash;
  }

  return new jose.SignJWT(payload).setProtectedHeader(header).sign(keyPair.privateKey);
}
