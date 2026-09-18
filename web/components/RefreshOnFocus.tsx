'use client';

import { useEffect, useRef } from 'react';
import { useRouter } from 'next/navigation';

/** Re-fetch server components when you come back to the app.
 *
 *  Pages are rendered per request and never cached (cache-control is
 *  no-store), so a fresh load is always current. But a tab left open — or the
 *  installed PWA resumed from memory — keeps Next's client-side router cache,
 *  and would still show this morning's state. Mark an episode on your phone,
 *  glance at the laptop, and it looks like the tap never registered.
 *
 *  Only refreshes after a real absence, so alt-tabbing does not spam the
 *  server, and never more than once every few seconds. */
const MIN_AWAY_MS = 10_000;
const MIN_GAP_MS = 5_000;

export default function RefreshOnFocus() {
  const router = useRouter();
  const awaySince = useRef<number | null>(null);
  const lastRefresh = useRef(0);

  useEffect(() => {
    const leave = () => {
      awaySince.current ??= Date.now();
    };

    const arrive = () => {
      const since = awaySince.current;
      awaySince.current = null;
      if (since === null || Date.now() - since < MIN_AWAY_MS) return;
      if (Date.now() - lastRefresh.current < MIN_GAP_MS) return;
      lastRefresh.current = Date.now();
      router.refresh();
    };

    const onVisibility = () =>
      document.visibilityState === 'hidden' ? leave() : arrive();

    document.addEventListener('visibilitychange', onVisibility);
    window.addEventListener('focus', arrive);
    window.addEventListener('blur', leave);
    // the PWA resuming from memory fires pageshow, not always focus
    window.addEventListener('pageshow', arrive);

    return () => {
      document.removeEventListener('visibilitychange', onVisibility);
      window.removeEventListener('focus', arrive);
      window.removeEventListener('blur', leave);
      window.removeEventListener('pageshow', arrive);
    };
  }, [router]);

  return null;
}
