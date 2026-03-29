import { cookies } from 'next/headers';
import { redirect } from 'next/navigation';
import { handleResponse } from './api-client';
import { env } from './env';
import { decryptTokens, SESSION_COOKIE_NAME } from './oauth';
import { refreshAccessToken } from './token-refresh';

async function getAccessToken(): Promise<string | null> {
  const cookieStore = await cookies();
  const sessionCookie = cookieStore.get(SESSION_COOKIE_NAME);
  if (!sessionCookie) {
    return null;
  }

  const tokens = decryptTokens(sessionCookie.value);
  if (!tokens) {
    return null;
  }

  if (tokens.expires_at > Date.now() + 30_000) {
    return tokens.access_token;
  }

  if (tokens.refresh_token) {
    const refreshed = await refreshAccessToken(tokens.refresh_token);
    if (refreshed) {
      return refreshed.access_token;
    }
  }

  return null;
}

export async function serverFetch<T>(path: string, init?: RequestInit): Promise<T> {
  const accessToken = await getAccessToken();
  if (!accessToken) {
    redirect('/auth/login');
  }

  const response = await fetch(`${env.API_URL}${path}`, {
    ...init,
    headers: {
      ...(init?.body ? { 'Content-Type': 'application/json' } : {}),
      Authorization: `Bearer ${accessToken}`,
      ...init?.headers,
    },
    cache: 'no-store',
  });

  if (response.status === 401) {
    redirect('/auth/login');
  }

  return handleResponse<T>(response);
}
