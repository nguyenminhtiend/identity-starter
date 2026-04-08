import { cookies } from 'next/headers';
import { NextResponse } from 'next/server';
import { basicAuthHeader, decryptTokens, OAUTH_CONFIG, SESSION_COOKIE_NAME } from '@/lib/oauth';

export async function POST() {
  const cookieStore = await cookies();
  const sessionCookie = cookieStore.get(SESSION_COOKIE_NAME);

  let idTokenHint: string | undefined;

  if (sessionCookie) {
    const tokens = decryptTokens(sessionCookie.value);
    idTokenHint = tokens?.id_token;

    if (tokens?.refresh_token) {
      await fetch(`${OAUTH_CONFIG.apiUrl}/oauth/revoke`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/x-www-form-urlencoded',
          Authorization: `Basic ${basicAuthHeader()}`,
        },
        body: new URLSearchParams({
          token: tokens.refresh_token,
          token_type_hint: 'refresh_token',
        }),
      }).catch(() => {});
    }

    cookieStore.delete(SESSION_COOKIE_NAME);
  }

  // Return the IdP end-session URL so the client can navigate the browser to
  // it. A server-side redirect (or fetch-followed redirect) can't clear the
  // IdP's cross-origin session cookie, which is why logout previously left the
  // user SSO'd straight back in on the next /auth/login visit.
  // The IdP only accepts post_logout_redirect_uri values that are registered
  // in the client's redirectUris. Reuse the OAuth callback URL — the callback
  // route already redirects to /auth/login when it's hit without a code.
  const endSessionParams = new URLSearchParams({
    post_logout_redirect_uri: OAUTH_CONFIG.redirectUri,
  });
  if (idTokenHint) {
    endSessionParams.set('id_token_hint', idTokenHint);
  }
  const endSessionUrl = `${OAUTH_CONFIG.apiUrl}/oauth/end-session?${endSessionParams.toString()}`;

  return NextResponse.json({ endSessionUrl });
}
