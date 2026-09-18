import type { NextConfig } from 'next';

const nextConfig: NextConfig = {
  // libSQL talks HTTP to Turso — no native module in the deployed app.
  // better-sqlite3 is a dev dependency now, used only by the migration script.
};

export default nextConfig;
