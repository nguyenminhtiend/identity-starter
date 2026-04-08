import { createHash, randomUUID } from 'node:crypto';
import * as jose from 'jose';

export interface DPoPKeyPairJwk {
  privateJwk: jose.JWK;
  publicJwk: jose.JWK;
}

export async function generateDPoPKeyPair(): Promise<DPoPKeyPairJwk> {
  const { privateKey, publicKey } = await jose.generateKeyPair('ES256', {
    extractable: true,
  });
  const privateJwk = await jose.exportJWK(privateKey);
  const publicJwk = await jose.exportJWK(publicKey);
  return { privateJwk, publicJwk };
}

export async function createDPoPProof(
  keyPair: DPoPKeyPairJwk,
  method: string,
  url: string,
  accessToken?: string,
): Promise<string> {
  const privateKey = await jose.importJWK(keyPair.privateJwk, 'ES256');

  const payload: jose.JWTPayload = {
    jti: randomUUID(),
    htm: method,
    htu: url,
    iat: Math.floor(Date.now() / 1000),
  };

  if (accessToken) {
    payload.ath = createHash('sha256').update(accessToken).digest('base64url');
  }

  return new jose.SignJWT(payload)
    .setProtectedHeader({
      typ: 'dpop+jwt',
      alg: 'ES256',
      jwk: keyPair.publicJwk,
    })
    .sign(privateKey);
}
