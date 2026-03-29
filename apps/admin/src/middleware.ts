import { type NextRequest, NextResponse } from 'next/server';

const SESSION_COOKIE_NAME = 'admin_session';

const PUBLIC_PATHS = new Set(['/auth/login', '/auth/callback']);

export function middleware(request: NextRequest) {
  const { pathname } = request.nextUrl;

  if (PUBLIC_PATHS.has(pathname)) {
    return NextResponse.next();
  }

  if (pathname === '/login') {
    return NextResponse.redirect(new URL('/auth/login', request.url));
  }

  const session = request.cookies.get(SESSION_COOKIE_NAME);

  if (!session) {
    return NextResponse.redirect(new URL('/auth/login', request.url));
  }

  return NextResponse.next();
}

export const config = {
  matcher: ['/((?!_next|favicon.ico|.*\\.).*)'],
};
