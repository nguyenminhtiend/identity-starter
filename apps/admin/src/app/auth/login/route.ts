import { cookies } from 'next/headers';
import { NextResponse } from 'next/server';
import { generateDPoPKeyPair } from '@/lib/dpop';
import {
  basicAuthHeader,
  generateCodeChallenge,
  generateCodeVerifier,
  generateState,
  OAUTH_CONFIG,
  PKCE_COOKIE_NAME,
} from '@/lib/oauth';

export async function GET() {
  const codeVerifier = generateCodeVerifier();
  const codeChallenge = generateCodeChallenge(codeVerifier);
  const state = generateState();
  const dpopKeyPair = await generateDPoPKeyPair();

  const parResponse = await fetch(`${OAUTH_CONFIG.apiUrl}/oauth/par`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Basic ${basicAuthHeader()}`,
    },
    body: JSON.stringify({
      response_type: 'code',
      client_id: OAUTH_CONFIG.clientId,
      redirect_uri: OAUTH_CONFIG.redirectUri,
      scope: OAUTH_CONFIG.scopes,
      code_challenge: codeChallenge,
      code_challenge_method: 'S256',
      state,
    }),
  });

  if (!parResponse.ok) {
    return NextResponse.json({ error: 'PAR request failed' }, { status: 502 });
  }

  const { request_uri } = (await parResponse.json()) as { request_uri: string };

  const cookieStore = await cookies();
  cookieStore.set(
    PKCE_COOKIE_NAME,
    JSON.stringify({
      codeVerifier,
      state,
      dpopPrivateJwk: dpopKeyPair.privateJwk,
      dpopPublicJwk: dpopKeyPair.publicJwk,
    }),
    {
      httpOnly: true,
      secure: process.env.NODE_ENV === 'production',
      sameSite: 'lax',
      path: '/',
      maxAge: 600,
    },
  );

  const authorizeParams = new URLSearchParams({
    request_uri,
    client_id: OAUTH_CONFIG.clientId,
  });
  const authorizeUrl = `${OAUTH_CONFIG.issuer}/oauth/authorize?${authorizeParams.toString()}`;

  return NextResponse.redirect(authorizeUrl);
}
