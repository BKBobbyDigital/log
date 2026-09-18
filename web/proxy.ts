import { NextResponse, type NextRequest } from 'next/server';
import { verifySession, SESSION_COOKIE } from '@/lib/auth';

/** Everything is private. One password, one very long-lived cookie.
 *  (Next 16 renamed the middleware convention to proxy.) */
export async function proxy(req: NextRequest) {
  const ok = await verifySession(req.cookies.get(SESSION_COOKIE)?.value);
  if (ok) return NextResponse.next();

  const url = req.nextUrl.clone();
  url.pathname = '/login';
  url.search = '';
  return NextResponse.redirect(url);
}

export const config = {
  // everything except the login route, static assets and the manifest
  matcher: ['/((?!login|api/health|_next/static|_next/image|favicon.ico|icon.svg|manifest.json).*)'],
};
