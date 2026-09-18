'use client';

import { useState, useTransition } from 'react';
import { markWatchedAction } from '@/app/actions';

/** Optimistic: the check flips immediately, the POST settles behind it.
 *  On a phone, waiting on a round trip before the tick moves feels broken. */
export default function MarkWatched({
  mediaId, episodeId, label = 'Mark watched',
}: { mediaId: number; episodeId: number | null; label?: string }) {
  const [done, setDone] = useState(false);
  const [pending, start] = useTransition();

  return (
    <button
      aria-label={label}
      title={label}
      disabled={done || pending}
      onClick={() => {
        setDone(true);
        start(async () => {
          try {
            await markWatchedAction(mediaId, episodeId);
          } catch {
            setDone(false); // reconcile on failure
          }
        });
      }}
      className={`grid size-9 shrink-0 place-items-center rounded-full border transition
        ${done
          ? 'border-transparent bg-accent text-white'
          : 'border-border bg-surface text-muted hover:border-accent hover:text-accent active:scale-90'}`}
    >
      <svg viewBox="0 0 24 24" className="size-5" fill="none" stroke="currentColor"
           strokeWidth={done ? 3 : 2.2} strokeLinecap="round" strokeLinejoin="round">
        <path d="M4 12.5 9.5 18 20 6.5" />
      </svg>
    </button>
  );
}
