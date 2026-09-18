/** Config comes from the environment, always.
 *
 *  This file is imported by middleware, which runs on the Edge runtime — no
 *  node:fs, no filesystem. Locally, web/.env.local symlinks to the project
 *  .env so Next loads the same file the Python scripts read; in production
 *  these are Netlify environment variables. */
export function conf(key: string, fallback = ''): string {
  // Trim: a trailing newline or space pasted into a dashboard field is a
  // classic source of "correct value, wrong behaviour".
  return (process.env[key] ?? '').trim() || fallback;
}

/** Characters a masked dashboard value leaves behind (bullets, dots, stars).
 *  Saving Netlify's masked display instead of the real value stores these,
 *  and the failure surfaces far away as an unrelated HTTP header error. */
export function looksMasked(value: string): boolean {
  return /[\u2022\u00b7\u2219\u25cf\u002a]{3,}/.test(value);
}

export function nonAscii(value: string): { index: number; code: number } | null {
  for (let i = 0; i < value.length; i++) {
    const code = value.charCodeAt(i);
    if (code > 127) return { index: i, code };
  }
  return null;
}
