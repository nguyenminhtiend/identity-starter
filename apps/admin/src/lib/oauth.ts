import { createCipheriv, createDecipheriv, createHash, randomBytes } from 'node:crypto';
import type { JWK } from 'jose';
import { env } from './env';

export const OAUTH_CONFIG = {
  clientId: env.ADMIN_OAUTH_CLIENT_ID,
  clientSecret: env.ADMIN_OAUTH_CLIENT_SECRET,
  issuer: env.IDP_ISSUER_URL,
  apiUrl: env.IDP_API_URL,
  redirectUri: env.ADMIN_OAUTH_REDIRECT_URI,
  scopes: 'openid profile email',
} as const;

export const SESSION_COOKIE_NAME = 'admin_session';
const PKCE_COOKIE_NAME = 'admin_pkce';

export function generateCodeVerifier(): string {
  return randomBytes(32).toString('base64url');
}

export function generateCodeChallenge(verifier: string): string {
  return createHash('sha256').update(verifier).digest('base64url');
}

export function generateState(): string {
  return randomBytes(16).toString('base64url');
}

export interface TokenSet {
  access_token: string;
  refresh_token?: string;
  id_token?: string;
  expires_at: number;
  dpop_private_jwk?: JWK;
  dpop_public_jwk?: JWK;
}

const ALGORITHM = 'aes-256-gcm';
const KEY = createHash('sha256').update(env.ADMIN_SESSION_SECRET).digest();

export function encryptTokens(tokens: TokenSet): string {
  const iv = randomBytes(12);
  const cipher = createCipheriv(ALGORITHM, KEY, iv);
  const plaintext = JSON.stringify(tokens);
  const encrypted = Buffer.concat([cipher.update(plaintext, 'utf8'), cipher.final()]);
  const tag = cipher.getAuthTag();
  return Buffer.concat([iv, tag, encrypted]).toString('base64url');
}

export function decryptTokens(encrypted: string): TokenSet | null {
  try {
    const buf = Buffer.from(encrypted, 'base64url');
    if (buf.length < 28) {
      return null;
    }
    const iv = buf.subarray(0, 12);
    const tag = buf.subarray(12, 28);
    const ciphertext = buf.subarray(28);
    const decipher = createDecipheriv(ALGORITHM, KEY, iv);
    decipher.setAuthTag(tag);
    const decrypted = Buffer.concat([decipher.update(ciphertext), decipher.final()]);
    return JSON.parse(decrypted.toString('utf8')) as TokenSet;
  } catch {
    return null;
  }
}

export function basicAuthHeader(): string {
  return Buffer.from(`${OAUTH_CONFIG.clientId}:${OAUTH_CONFIG.clientSecret}`).toString('base64');
}

export { PKCE_COOKIE_NAME };
