import { createHash } from 'node:crypto';
import { ValidationError } from '@identity-starter/core';
import * as jose from 'jose';

/** Default proof freshness window; align with `DPOP_NONCE_TTL_SECONDS` when wiring from env. */
const DEFAULT_DPOP_PROOF_MAX_AGE_SECONDS = 300;

const DPOP_JWT_TYP = 'dpop+jwt';

const DPOP_JWS_ALGORITHMS: jose.JWSAlgorithm[] = [
  'RS256',
  'RS384',
  'RS512',
  'PS256',
  'PS384',
  'PS512',
  'ES256',
  'ES384',
  'ES512',
];

const DPOP_IAT_CLOCK_TOLERANCE_SECONDS = 60;

function computeAccessTokenHash(accessToken: string): string {
  return createHash('sha256').update(accessToken, 'utf8').digest('base64url');
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function assertDpopHeader(
  header: jose.ProtectedHeaderParameters,
): asserts header is jose.ProtectedHeaderParameters & {
  alg: jose.JWSAlgorithm;
  jwk: jose.JWK;
} {
  if (header.typ !== DPOP_JWT_TYP) {
    throw new ValidationError('Invalid DPoP proof header', { typ: 'Invalid' });
  }
  if (
    typeof header.alg !== 'string' ||
    !DPOP_JWS_ALGORITHMS.includes(header.alg as jose.JWSAlgorithm)
  ) {
    throw new ValidationError('Invalid DPoP proof algorithm', { alg: 'Invalid' });
  }
  if (!isRecord(header.jwk)) {
    throw new ValidationError('DPoP proof header must contain a public JWK', { jwk: 'Required' });
  }
}

export async function calculateJkt(publicJwk: jose.JWK): Promise<string> {
  return jose.calculateJwkThumbprint(publicJwk, 'sha256');
}

export interface ValidateDpopProofParams {
  htm: string;
  htu: string;
  accessToken?: string;
  maxAgeSeconds?: number;
}

export async function validateDpopProof(
  proofJwt: string,
  params: ValidateDpopProofParams,
): Promise<{ jkt: string; publicKey: jose.KeyLike }> {
  let protectedHeader: jose.ProtectedHeaderParameters;
  try {
    protectedHeader = jose.decodeProtectedHeader(proofJwt);
  } catch {
    throw new ValidationError('Invalid DPoP proof JWT', { dpop: 'Invalid' });
  }

  assertDpopHeader(protectedHeader);
  const { alg, jwk } = protectedHeader;

  let publicKey: jose.KeyLike;
  try {
    publicKey = await jose.importJWK(jwk, alg);
  } catch {
    throw new ValidationError('Invalid DPoP proof public JWK', { jwk: 'Invalid' });
  }

  let payload: jose.JWTPayload;
  try {
    const verified = await jose.jwtVerify(proofJwt, publicKey, {
      algorithms: DPOP_JWS_ALGORITHMS,
    });
    payload = verified.payload;
  } catch {
    throw new ValidationError('Invalid DPoP proof signature', { dpop: 'Invalid' });
  }

  if (typeof payload.jti !== 'string' || payload.jti.length === 0) {
    throw new ValidationError('DPoP proof is missing jti', { jti: 'Required' });
  }
  if (typeof payload.htm !== 'string' || payload.htm.length === 0) {
    throw new ValidationError('DPoP proof is missing htm', { htm: 'Required' });
  }
  if (typeof payload.htu !== 'string' || payload.htu.length === 0) {
    throw new ValidationError('DPoP proof is missing htu', { htu: 'Required' });
  }
  if (typeof payload.iat !== 'number') {
    throw new ValidationError('DPoP proof is missing iat', { iat: 'Required' });
  }

  if (payload.htm !== params.htm) {
    throw new ValidationError('DPoP proof htm does not match request method', { htm: 'Mismatch' });
  }
  if (payload.htu !== params.htu) {
    throw new ValidationError('DPoP proof htu does not match request URL', { htu: 'Mismatch' });
  }

  const maxAgeSeconds = params.maxAgeSeconds ?? DEFAULT_DPOP_PROOF_MAX_AGE_SECONDS;
  const now = Math.floor(Date.now() / 1000);
  if (payload.iat > now + DPOP_IAT_CLOCK_TOLERANCE_SECONDS) {
    throw new ValidationError('DPoP proof iat is in the future', { iat: 'Invalid' });
  }
  if (now - payload.iat > maxAgeSeconds + DPOP_IAT_CLOCK_TOLERANCE_SECONDS) {
    throw new ValidationError('DPoP proof has expired', { iat: 'Expired' });
  }

  if (params.accessToken !== undefined) {
    const expectedAth = computeAccessTokenHash(params.accessToken);
    if (typeof payload.ath !== 'string' || payload.ath.length === 0) {
      throw new ValidationError('DPoP proof is missing ath for access token binding', {
        ath: 'Required',
      });
    }
    if (payload.ath !== expectedAth) {
      throw new ValidationError('DPoP proof ath does not match access token', { ath: 'Mismatch' });
    }
  }

  const jkt = await calculateJkt(jwk);
  return { jkt, publicKey };
}
