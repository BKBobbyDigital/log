'use client';

import { useTransition } from 'react';
import { markSeasonWatchedAction } from '@/app/actions';

export default function MarkSeason({ mediaId, season, pending }: {
  mediaId: number; season: number; pending: number;
}) {
  const [busy, start] = useTransition();
  if (pending === 0) return null;
  return (
    <button disabled={busy}
      onClick={() => start(() => { void markSeasonWatchedAction(mediaId, season); })}
      className="rounded-lg border border-border px-3 py-1.5 text-sm font-medium
                 text-muted hover:border-accent hover:text-accent disabled:opacity-50">
      {busy ? 'Marking…' : `Mark ${pending} watched`}
    </button>
  );
}
