import { createHash } from 'node:crypto';
import * as jose from 'jose';
import { v7 as uuidv7 } from 'uuid';
import type { ActiveSigningKeyResult } from './signing-key.service.js';

export interface AccessTokenParams {
  issuer: string;
  subject: string;
  audience: string;
  scope: string;
  clientId: string;
  expiresInSeconds: number;
}

export interface IdTokenParams {
  issuer: string;
  subject: string;
  audience: string;
  nonce?: string;
  authTime: number;
  acr: string;
  amr: string[];
  accessToken: string;
  expiresInSeconds: number;
  sessionId?: string;
}

export interface VerifyResult {
  payload: jose.JWTPayload;
  protectedHeader: jose.JWTHeaderParameters;
}

export function computeAtHash(accessToken: string): string {
  const hash = createHash('sha256').update(accessToken).digest();
  const leftHalf = hash.subarray(0, hash.length / 2);
  return jose.base64url.encode(leftHalf);
}

export async function issueAccessToken(
  signingKey: ActiveSigningKeyResult,
  params: AccessTokenParams,
): Promise<string> {
  const now = Math.floor(Date.now() / 1000);
  const jti = uuidv7();

  return new jose.SignJWT({
    scope: params.scope,
    client_id: params.clientId,
    jti,
  })
    .setProtectedHeader({ alg: 'RS256', kid: signingKey.kid })
    .setIssuer(params.issuer)
    .setSubject(params.subject)
    .setAudience(params.audience)
    .setIssuedAt(now)
    .setExpirationTime(now + params.expiresInSeconds)
    .sign(signingKey.privateKey);
}

export async function issueIdToken(
  signingKey: ActiveSigningKeyResult,
  params: IdTokenParams,
): Promise<string> {
  const now = Math.floor(Date.now() / 1000);
  const atHash = computeAtHash(params.accessToken);

  const claims: Record<string, unknown> = {
    at_hash: atHash,
    auth_time: params.authTime,
    acr: params.acr,
    amr: params.amr,
  };

  if (params.nonce !== undefined) {
    claims.nonce = params.nonce;
  }

  if (params.sessionId !== undefined) {
    claims.sid = params.sessionId;
  }

  return new jose.SignJWT(claims)
    .setProtectedHeader({ alg: 'RS256', kid: signingKey.kid })
    .setIssuer(params.issuer)
    .setSubject(params.subject)
    .setAudience(params.audience)
    .setIssuedAt(now)
    .setExpirationTime(now + params.expiresInSeconds)
    .sign(signingKey.privateKey);
}

export async function verifyAccessToken(
  jwksUrl: string | jose.JWTVerifyGetKey,
  token: string,
  issuer: string,
): Promise<VerifyResult | null> {
  const keyResolver =
    typeof jwksUrl === 'string' ? jose.createRemoteJWKSet(new URL(jwksUrl)) : jwksUrl;

  try {
    const { payload, protectedHeader } = await jose.jwtVerify(token, keyResolver, {
      issuer,
      algorithms: ['RS256'],
    });
    return { payload, protectedHeader };
  } catch {
    return null;
  }
}
