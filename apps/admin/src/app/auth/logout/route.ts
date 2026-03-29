import { cookies } from 'next/headers';
import { type NextRequest, NextResponse } from 'next/server';
import { decryptTokens, OAUTH_CONFIG, SESSION_COOKIE_NAME } from '@/lib/oauth';

export async function POST(request: NextRequest) {
  const cookieStore = await cookies();
  const sessionCookie = cookieStore.get(SESSION_COOKIE_NAME);

  if (sessionCookie) {
    const tokens = decryptTokens(sessionCookie.value);

    if (tokens?.refresh_token) {
      const basicAuth = Buffer.from(
        `${OAUTH_CONFIG.clientId}:${OAUTH_CONFIG.clientSecret}`,
      ).toString('base64');

      await fetch(`${OAUTH_CONFIG.apiUrl}/oauth/revoke`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/x-www-form-urlencoded',
          Authorization: `Basic ${basicAuth}`,
        },
        body: new URLSearchParams({
          token: tokens.refresh_token,
          token_type_hint: 'refresh_token',
        }),
      }).catch(() => {});
    }

    cookieStore.delete(SESSION_COOKIE_NAME);
  }

  return NextResponse.redirect(new URL('/auth/login', request.url));
}
