'use client';

import { useState, useTransition } from 'react';
import {
  markWatchedAction, markWatchedOnAction, unmarkLatestAction,
} from '@/app/actions';
import type { EpisodeRow as Ep } from '@/lib/db';

function dayOffset(n: number, tz: string) {
  return new Intl.DateTimeFormat('en-CA', { timeZone: tz })
    .format(new Date(Date.now() - n * 86400_000));
}

export default function EpisodeRow({ mediaId, ep, tz }: { mediaId: number; ep: Ep; tz: string }) {
  const [plays, setPlays] = useState(ep.plays);
  const [menu, setMenu] = useState(false);
  const [, start] = useTransition();

  const aired = ep.air_date !== null && ep.air_date <= dayOffset(0, tz);
  const watched = plays > 0;

  const mark = (day?: string) => {
    setPlays(p => p + 1); setMenu(false);
    start(() => {
      void (day
        ? markWatchedOnAction(mediaId, ep.id, day)
        : markWatchedAction(mediaId, ep.id));
    });
  };
  const unmark = () => {
    setPlays(p => Math.max(0, p - 1)); setMenu(false);
    start(() => { void unmarkLatestAction(mediaId, ep.id); });
  };

  return (
    <li className="relative flex items-center gap-3 border-b border-border py-2.5 last:border-0">
      <span className="w-8 shrink-0 text-right text-sm tabular-nums text-muted">{ep.number}</span>
      <div className="min-w-0 flex-1">
        <p className={`truncate text-sm ${watched ? 'text-muted' : 'font-medium'}`}>
          {ep.title ?? `Episode ${ep.number}`}
        </p>
        <p className="truncate text-xs text-muted">
          {ep.air_date ?? 'TBA'}
          {ep.runtime ? ` · ${ep.runtime}m` : ''}
          {plays > 1 ? ` · ${plays} plays` : ''}
          {!aired && ep.air_date ? ' · not aired' : ''}
        </p>
      </div>

      <button onClick={() => setMenu(m => !m)} aria-label="More"
        className="px-1.5 text-muted hover:text-foreground">···</button>

      <button
        onClick={() => (watched ? unmark() : mark())}
        disabled={!aired && !watched}
        aria-label={watched ? 'Unmark' : 'Mark watched'}
        className={`grid size-8 shrink-0 place-items-center rounded-full border transition
          ${watched
            ? 'border-transparent bg-accent text-white'
            : aired
              ? 'border-border text-muted hover:border-accent hover:text-accent active:scale-90'
              : 'border-border/50 text-muted/40'}`}>
        <svg viewBox="0 0 24 24" className="size-4" fill="none" stroke="currentColor"
             strokeWidth={watched ? 3 : 2.2} strokeLinecap="round" strokeLinejoin="round">
          <path d="M4 12.5 9.5 18 20 6.5" />
        </svg>
      </button>

      {menu && (
        <div className="absolute right-0 top-full z-20 mt-1 w-44 overflow-hidden rounded-lg
                        border border-border bg-surface text-sm shadow-lg">
          {[['Today', 0], ['Yesterday', 1], ['2 days ago', 2]].map(([label, n]) => (
            <button key={label as string} onClick={() => mark(dayOffset(n as number, tz))}
              className="block w-full px-3 py-2 text-left hover:bg-accent-soft">
              {label as string}
            </button>
          ))}
          <label className="block cursor-pointer px-3 py-2 hover:bg-accent-soft">
            Pick a date…
            <input type="date" className="sr-only"
              onChange={e => e.target.value && mark(e.target.value)} />
          </label>
          {watched && (
            <button onClick={unmark}
              className="block w-full border-t border-border px-3 py-2 text-left text-muted hover:bg-accent-soft">
              Remove last play
            </button>
          )}
        </div>
      )}
    </li>
  );
}
