'use client';

import { useState, useTransition } from 'react';
import { setStatusAction } from '@/app/actions';

const OPTIONS = [
  { key: 'watchlist', label: 'Watchlist' },
  { key: 'watching', label: 'Watching' },
  { key: 'watched', label: 'Watched' },
  { key: 'stopped', label: 'Stopped' },
];

/** The only control in the app that writes media.status. */
export default function StatusControl({
  mediaId, status,
}: { mediaId: number; status: string | null }) {
  const [value, setValue] = useState(status);
  const [, start] = useTransition();
  return (
    <div className="flex flex-wrap gap-1.5">
      {OPTIONS.map(o => (
        <button key={o.key}
          onClick={() => { setValue(o.key); start(() => { void setStatusAction(mediaId, o.key); }); }}
          className={`rounded-full px-3 py-1.5 text-sm font-medium transition ${
            value === o.key
              ? 'bg-accent text-white'
              : 'border border-border bg-surface text-muted hover:text-foreground'}`}>
          {o.label}
        </button>
      ))}
    </div>
  );
}
