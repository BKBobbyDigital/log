import { conf } from './config';

const COOKIE = 'log_session';
const MAX_AGE = 60 * 60 * 24 * 365;   // a year — this should never log you out

function secret() {
  const s = conf('AUTH_SECRET');
  if (!s) throw new Error('AUTH_SECRET is not set');
  return new TextEncoder().encode(s);
}

async function sign(value: string): Promise<string> {
  const key = await crypto.subtle.importKey(
    'raw', secret(), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']);
  const mac = await crypto.subtle.sign('HMAC', key, new TextEncoder().encode(value));
  const hex = Array.from(new Uint8Array(mac)).map(b => b.toString(16).padStart(2, '0')).join('');
  return `${value}.${hex}`;
}

export async function createSession(): Promise<{ name: string; value: string; options: object }> {
  const value = await sign(String(Date.now()));
  return {
    name: COOKIE,
    value,
    options: {
      httpOnly: true,
      sameSite: 'lax' as const,
      secure: process.env.NODE_ENV === 'production',
      path: '/',
      maxAge: MAX_AGE,
    },
  };
}

/** Constant-time compare, so a wrong cookie can't be guessed byte by byte. */
function timingSafeEqual(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
}

export async function verifySession(cookieValue: string | undefined): Promise<boolean> {
  if (!cookieValue) return false;
  const idx = cookieValue.lastIndexOf('.');
  if (idx < 1) return false;
  const issued = cookieValue.slice(0, idx);
  try {
    return timingSafeEqual(await sign(issued), cookieValue);
  } catch {
    return false;
  }
}

export async function checkPassword(input: string): Promise<boolean> {
  const expected = conf('APP_PASSWORD');
  if (!expected) return false;
  return timingSafeEqual(input, expected);
}

export const SESSION_COOKIE = COOKIE;

/** Server-side gate for a page or action.
 *
 *  Defence in depth: proxy.ts already redirects unauthenticated requests, but
 *  that depends on the host runtime honouring Next 16's proxy convention. If
 *  it silently does not, every page would serve the full library to anyone
 *  with the URL. This check does not depend on the host at all. */
export async function requireAuth(): Promise<void> {
  const { cookies } = await import('next/headers');
  const { redirect } = await import('next/navigation');
  const ok = await verifySession((await cookies()).get(COOKIE)?.value);
  if (!ok) redirect('/login');
}
