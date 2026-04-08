import type { JWK } from 'jose';
import { cookies } from 'next/headers';
import { type NextRequest, NextResponse } from 'next/server';
import { createDPoPProof } from '@/lib/dpop';
import {
  basicAuthHeader,
  encryptTokens,
  OAUTH_CONFIG,
  PKCE_COOKIE_NAME,
  SESSION_COOKIE_NAME,
  type TokenSet,
} from '@/lib/oauth';

interface PkceCookieData {
  codeVerifier: string;
  state: string;
  dpopPrivateJwk: JWK;
  dpopPublicJwk: JWK;
}

export async function GET(request: NextRequest) {
  const { searchParams } = request.nextUrl;
  const code = searchParams.get('code');
  const state = searchParams.get('state');
  const error = searchParams.get('error');

  if (error) {
    const url = new URL('/auth/login', request.url);
    url.searchParams.set('error', error);
    return NextResponse.redirect(url);
  }

  if (!code || !state) {
    return NextResponse.redirect(new URL('/auth/login', request.url));
  }

  const cookieStore = await cookies();
  const pkceCookie = cookieStore.get(PKCE_COOKIE_NAME);
  if (!pkceCookie) {
    return NextResponse.redirect(new URL('/auth/login', request.url));
  }

  let pkceData: PkceCookieData;
  try {
    pkceData = JSON.parse(pkceCookie.value);
  } catch {
    return NextResponse.redirect(new URL('/auth/login', request.url));
  }

  if (
    state !== pkceData.state ||
    !pkceData.codeVerifier ||
    !pkceData.dpopPrivateJwk ||
    !pkceData.dpopPublicJwk
  ) {
    cookieStore.delete(PKCE_COOKIE_NAME);
    return NextResponse.redirect(new URL('/auth/login', request.url));
  }

  const tokenUrl = `${OAUTH_CONFIG.apiUrl}/oauth/token`;
  const dpopKeyPair = {
    privateJwk: pkceData.dpopPrivateJwk,
    publicJwk: pkceData.dpopPublicJwk,
  };
  const dpopProof = await createDPoPProof(dpopKeyPair, 'POST', tokenUrl);

  const tokenResponse = await fetch(tokenUrl, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/x-www-form-urlencoded',
      Authorization: `Basic ${basicAuthHeader()}`,
      DPoP: dpopProof,
    },
    body: new URLSearchParams({
      grant_type: 'authorization_code',
      code,
      redirect_uri: OAUTH_CONFIG.redirectUri,
      code_verifier: pkceData.codeVerifier,
    }),
  });

  if (!tokenResponse.ok) {
    return NextResponse.redirect(new URL('/auth/login', request.url));
  }

  const tokens = (await tokenResponse.json()) as {
    access_token: string;
    refresh_token?: string;
    id_token?: string;
    expires_in: number;
    token_type: string;
  };

  const tokenSet: TokenSet = {
    access_token: tokens.access_token,
    refresh_token: tokens.refresh_token,
    id_token: tokens.id_token,
    expires_at: Date.now() + tokens.expires_in * 1000,
    dpop_private_jwk: dpopKeyPair.privateJwk,
    dpop_public_jwk: dpopKeyPair.publicJwk,
  };

  const encrypted = encryptTokens(tokenSet);

  cookieStore.set(SESSION_COOKIE_NAME, encrypted, {
    httpOnly: true,
    secure: process.env.NODE_ENV === 'production',
    sameSite: 'lax',
    path: '/',
    maxAge: 60 * 60 * 24 * 7,
  });

  cookieStore.delete(PKCE_COOKIE_NAME);

  return NextResponse.redirect(new URL('/users', request.url));
}
