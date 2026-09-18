'use client';

import { useState, useTransition } from 'react';
import { markWatchedAction, markWatchedOnAction, unmarkWatchAction } from '@/app/actions';

const off = (n: number, tz: string) =>
  new Intl.DateTimeFormat('en-CA', { timeZone: tz }).format(new Date(Date.now() - n * 86400_000));

export function MarkMovie({ mediaId, plays, tz }: { mediaId: number; plays: number; tz: string }) {
  const [n, setN] = useState(plays);
  const [menu, setMenu] = useState(false);
  const [, start] = useTransition();
  const mark = (day?: string) => {
    setN(v => v + 1); setMenu(false);
    start(() => {
      void (day ? markWatchedOnAction(mediaId, null, day) : markWatchedAction(mediaId, null));
    });
  };
  return (
    <div className="relative flex items-center gap-2">
      <button onClick={() => mark()}
        className="flex items-center gap-2 rounded-lg bg-accent px-4 py-2 text-sm
                   font-semibold text-white active:scale-95">
        <svg viewBox="0 0 24 24" className="size-4" fill="none" stroke="currentColor"
             strokeWidth={2.5} strokeLinecap="round" strokeLinejoin="round">
          <path d="M4 12.5 9.5 18 20 6.5" />
        </svg>
        {n > 0 ? 'Watch again' : 'Mark watched'}
      </button>
      <button onClick={() => setMenu(m => !m)} aria-label="More"
        className="rounded-lg border border-border px-2.5 py-2 text-muted hover:text-foreground">···</button>
      {n > 0 && <span className="text-sm text-muted">{n} play{n === 1 ? '' : 's'}</span>}
      {menu && (
        <div className="absolute left-0 top-full z-20 mt-1 w-44 overflow-hidden rounded-lg
                        border border-border bg-surface text-sm shadow-lg">
          {[['Today', 0], ['Yesterday', 1], ['2 days ago', 2]].map(([l, d]) => (
            <button key={l as string} onClick={() => mark(off(d as number, tz))}
              className="block w-full px-3 py-2 text-left hover:bg-accent-soft">{l as string}</button>
          ))}
          <label className="block cursor-pointer px-3 py-2 hover:bg-accent-soft">
            Pick a date…
            <input type="date" className="sr-only"
              onChange={e => e.target.value && mark(e.target.value)} />
          </label>
        </div>
      )}
    </div>
  );
}

export function RemovePlay({ watchId }: { watchId: number }) {
  const [gone, setGone] = useState(false);
  const [, start] = useTransition();
  if (gone) return null;
  return (
    <button onClick={() => { setGone(true); start(() => { void unmarkWatchAction(watchId); }); }}
      className="text-xs text-muted hover:text-foreground">Remove</button>
  );
}
