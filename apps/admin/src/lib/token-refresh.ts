import { cookies } from 'next/headers';
import { createDPoPProof, type DPoPKeyPairJwk } from './dpop';
import {
  basicAuthHeader,
  encryptTokens,
  OAUTH_CONFIG,
  SESSION_COOKIE_NAME,
  type TokenSet,
} from './oauth';

export async function refreshAccessToken(
  refreshToken: string,
  dpopKeyPair?: DPoPKeyPairJwk,
): Promise<TokenSet | null> {
  const tokenUrl = `${OAUTH_CONFIG.apiUrl}/oauth/token`;

  const headers: Record<string, string> = {
    'Content-Type': 'application/x-www-form-urlencoded',
    Authorization: `Basic ${basicAuthHeader()}`,
  };

  if (dpopKeyPair) {
    headers.DPoP = await createDPoPProof(dpopKeyPair, 'POST', tokenUrl);
  }

  const response = await fetch(tokenUrl, {
    method: 'POST',
    headers,
    body: new URLSearchParams({
      grant_type: 'refresh_token',
      refresh_token: refreshToken,
    }),
  });

  if (!response.ok) {
    return null;
  }

  const data = (await response.json()) as {
    access_token: string;
    refresh_token?: string;
    id_token?: string;
    expires_in: number;
  };

  const tokenSet: TokenSet = {
    access_token: data.access_token,
    refresh_token: data.refresh_token ?? refreshToken,
    id_token: data.id_token,
    expires_at: Date.now() + data.expires_in * 1000,
    dpop_private_jwk: dpopKeyPair?.privateJwk,
    dpop_public_jwk: dpopKeyPair?.publicJwk,
  };

  const encrypted = encryptTokens(tokenSet);
  const cookieStore = await cookies();
  cookieStore.set(SESSION_COOKIE_NAME, encrypted, {
    httpOnly: true,
    secure: process.env.NODE_ENV === 'production',
    sameSite: 'lax',
    path: '/',
    maxAge: 60 * 60 * 24 * 7,
  });

  return tokenSet;
}
