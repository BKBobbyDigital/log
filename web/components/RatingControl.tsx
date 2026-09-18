'use client';

import { useState, useTransition } from 'react';
import { setRatingAction } from '@/app/actions';

/** No prompt anywhere — rating is always opt-in. */
export default function RatingControl({
  mediaId, rating,
}: { mediaId: number; rating: number | null }) {
  const [value, setValue] = useState(rating);
  const [, start] = useTransition();
  const set = (n: number | null) => {
    setValue(n);
    start(() => { void setRatingAction(mediaId, n); });
  };
  return (
    <div className="flex items-center gap-1">
      {Array.from({ length: 10 }, (_, i) => i + 1).map(n => (
        <button key={n} onClick={() => set(value === n ? null : n)}
          aria-label={`Rate ${n}`}
          className={`size-6 rounded text-xs font-medium transition ${
            value && n <= value
              ? 'bg-accent text-white'
              : 'border border-border text-muted hover:border-accent'}`}>
          {n}
        </button>
      ))}
      {value && (
        <button onClick={() => set(null)} className="ml-2 text-xs text-muted hover:text-foreground">
          Clear
        </button>
      )}
    </div>
  );
}
