import { cookies } from 'next/headers';
import { NextResponse } from 'next/server';
import {
  buildAuthorizeUrl,
  generateCodeChallenge,
  generateCodeVerifier,
  generateState,
  PKCE_COOKIE_NAME,
} from '@/lib/oauth';

export async function GET() {
  const codeVerifier = generateCodeVerifier();
  const codeChallenge = generateCodeChallenge(codeVerifier);
  const state = generateState();

  const cookieStore = await cookies();
  cookieStore.set(PKCE_COOKIE_NAME, JSON.stringify({ codeVerifier, state }), {
    httpOnly: true,
    secure: process.env.NODE_ENV === 'production',
    sameSite: 'lax',
    path: '/',
    maxAge: 600,
  });

  const authorizeUrl = buildAuthorizeUrl(state, codeChallenge);
  return NextResponse.redirect(authorizeUrl);
}
