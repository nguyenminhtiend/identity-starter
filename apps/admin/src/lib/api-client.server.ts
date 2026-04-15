import { cookies } from 'next/headers';
import { redirect } from 'next/navigation';
import { handleResponse } from '@/lib/api-client';
import { createDPoPProof, type DPoPKeyPairJwk } from './dpop';
import { env } from './env';
import { decryptTokens, SESSION_COOKIE_NAME, type TokenSet } from './oauth';
import { refreshAccessToken } from './token-refresh';

export interface ResolvedCredentials {
  accessToken: string;
  dpopKeyPair: DPoPKeyPairJwk;
}

export async function getCredentials(): Promise<ResolvedCredentials | null> {
  const cookieStore = await cookies();
  const sessionCookie = cookieStore.get(SESSION_COOKIE_NAME);
  if (!sessionCookie) {
    return null;
  }

  const tokens = decryptTokens(sessionCookie.value);
  if (!tokens) {
    return null;
  }

  const dpopKeyPair = extractDPoPKeyPair(tokens);

  // Sessions minted before the DPoP upgrade have no bound key pair and cannot
  // be used against the now-DPoP-bound API. Force a fresh login.
  if (!dpopKeyPair) {
    cookieStore.delete(SESSION_COOKIE_NAME);
    return null;
  }

  if (tokens.expires_at > Date.now() + 30_000) {
    return { accessToken: tokens.access_token, dpopKeyPair };
  }

  if (tokens.refresh_token) {
    const refreshed = await refreshAccessToken(tokens.refresh_token, dpopKeyPair);
    if (refreshed) {
      return { accessToken: refreshed.access_token, dpopKeyPair };
    }
  }

  return null;
}

function extractDPoPKeyPair(tokens: TokenSet): DPoPKeyPairJwk | undefined {
  if (tokens.dpop_private_jwk && tokens.dpop_public_jwk) {
    return { privateJwk: tokens.dpop_private_jwk, publicJwk: tokens.dpop_public_jwk };
  }
  return undefined;
}

export async function serverFetch<T>(path: string, init?: RequestInit): Promise<T> {
  const creds = await getCredentials();
  if (!creds) {
    redirect('/auth/login');
  }

  const fullUrl = `${env.API_URL}${path}`;
  const method = init?.method?.toUpperCase() ?? 'GET';
  const htu = fullUrl.split('?')[0];
  const dpopProof = await createDPoPProof(creds.dpopKeyPair, method, htu, creds.accessToken);
  const headers: Record<string, string> = {
    ...(init?.body ? { 'Content-Type': 'application/json' } : {}),
    Authorization: `DPoP ${creds.accessToken}`,
    DPoP: dpopProof,
  };

  const response = await fetch(fullUrl, {
    ...init,
    headers: {
      ...headers,
      ...init?.headers,
    },
    cache: 'no-store',
  });

  if (response.status === 401) {
    redirect('/auth/login');
  }

  return handleResponse<T>(response);
}
