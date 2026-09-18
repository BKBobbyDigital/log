'use client';

import { useState, useTransition } from 'react';
import { setStatusAction, dismissDecisionAction } from '@/app/actions';
import type { RevivedItem } from '@/lib/db';

/** A show you finished has aired new episodes. Shows that end while you're
 *  caught up now finish themselves (scripts/auto_finish.py); this is the
 *  reverse case, and it stays a prompt — never an automatic change. */
export default function Revived({ items }: { items: RevivedItem[] }) {
  const [dismissed, setDismissed] = useState<Set<number>>(new Set());
  const [, start] = useTransition();
  const live = items.filter(i => !dismissed.has(i.media_id));
  if (live.length === 0) return null;

  const item = live[0];
  const act = (status: string | null) => {
    setDismissed(prev => new Set(prev).add(item.media_id));
    start(() => {
      void (status
        ? setStatusAction(item.media_id, status)
        : dismissDecisionAction(item.media_id));
    });
  };

  return (
    <section className="px-4 pt-3">
      <div className="rounded-xl border border-border bg-surface p-4">
        <div className="mb-2 flex items-center gap-2">
          <span className="rounded-full bg-accent-soft px-2 py-0.5 text-xs font-medium text-accent">
            Back with new episodes
          </span>
          {live.length > 1 && (
            <span className="text-xs text-muted">{live.length - 1} more</span>
          )}
        </div>
        <p className="text-sm">
          <span className="font-semibold">{item.title}</span>{' '}
          <span className="text-muted">
            has {item.new_episodes} episode{item.new_episodes === 1 ? '' : 's'} you
            haven&apos;t seen, first aired {item.first_new_air_date}.
          </span>
        </p>
        <div className="mt-3 flex gap-2">
          <button onClick={() => act('watching')}
            className="rounded-lg bg-accent px-3 py-1.5 text-sm font-medium text-white active:scale-95">
            Resume
          </button>
          <button onClick={() => act('stopped')}
            className="rounded-lg border border-border px-3 py-1.5 text-sm font-medium active:scale-95">
            Stopped
          </button>
          <button onClick={() => act(null)}
            className="ml-auto px-2 py-1.5 text-sm text-muted hover:text-foreground">
            Not now
          </button>
        </div>
      </div>
    </section>
  );
}
