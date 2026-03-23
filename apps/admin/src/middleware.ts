import { type NextRequest, NextResponse } from 'next/server';

const SESSION_COOKIE_NAME = 'admin_session';

export function middleware(request: NextRequest) {
  const { pathname } = request.nextUrl;

  // For API requests: inject session cookie name header so the server
  // sets/reads the correct cookie (avoids collision with the web app).
  if (pathname.startsWith('/api/')) {
    const requestHeaders = new Headers(request.headers);
    requestHeaders.set('x-session-cookie', SESSION_COOKIE_NAME);
    return NextResponse.next({ request: { headers: requestHeaders } });
  }

  const session = request.cookies.get(SESSION_COOKIE_NAME);

  if (pathname === '/login') {
    if (session) {
      return NextResponse.redirect(new URL('/users', request.url));
    }
    return NextResponse.next();
  }

  if (!session) {
    return NextResponse.redirect(new URL('/login', request.url));
  }

  return NextResponse.next();
}

export const config = {
  matcher: ['/((?!_next|favicon.ico|.*\\.).*)'],
};
