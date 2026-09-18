/** Config comes from the environment, always.
 *
 *  This file is imported by middleware, which runs on the Edge runtime — no
 *  node:fs, no filesystem. Locally, web/.env.local symlinks to the project
 *  .env so Next loads the same file the Python scripts read; in production
 *  these are Netlify environment variables. */
export function conf(key: string, fallback = ''): string {
  return process.env[key] || fallback;
}
