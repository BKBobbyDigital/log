'use client';

import { useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import { addToLibraryAction } from '@/app/actions';

const CHOICES = [
  { key: 'watchlist', label: 'Watchlist' },
  { key: 'watching', label: 'Watching' },
  { key: 'watched', label: 'Watched' },
];

export default function AddToLibrary({
  tmdbId, type, inLibrary,
}: { tmdbId: number; type: 'movie' | 'show'; inLibrary: number | null }) {
  const [open, setOpen] = useState(false);
  const [added, setAdded] = useState<number | null>(inLibrary);
  const [busy, start] = useTransition();
  const router = useRouter();

  if (added) {
    return (
      <button onClick={() => router.push(`/${type}/${added}`)}
        className="rounded-lg border border-border px-3 py-1.5 text-xs font-medium text-muted
                   hover:border-accent hover:text-accent">
        In library →
      </button>
    );
  }

  if (!open) {
    return (
      <button onClick={() => setOpen(true)} disabled={busy}
        className="rounded-lg bg-accent px-3 py-1.5 text-xs font-semibold text-white
                   active:scale-95 disabled:opacity-50">
        {busy ? 'Adding…' : 'Add'}
      </button>
    );
  }

  return (
    <div className="flex flex-wrap gap-1">
      {CHOICES.map(c => (
        <button key={c.key} disabled={busy}
          onClick={() => {
            setOpen(false);
            start(async () => {
              // shows also pull their full episode list, so this is not instant
              const id = await addToLibraryAction(tmdbId, type, c.key);
              if (id) setAdded(id);
            });
          }}
          className="rounded-lg border border-border px-2.5 py-1.5 text-xs font-medium
                     hover:border-accent hover:text-accent disabled:opacity-50">
          {c.label}
        </button>
      ))}
    </div>
  );
}
