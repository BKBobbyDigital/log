import Link from 'next/link';
import { poster, still } from '@/lib/tmdb';
import type { UpNextItem, CalendarItem } from '@/lib/db';
import MarkWatched from './MarkWatched';

function Art({ src, alt, className }: { src: string | null; alt: string; className: string }) {
  if (!src) return <div className={`bg-border ${className}`} />;
  /* eslint-disable-next-line @next/next/no-img-element */
  return <img src={src} alt={alt} loading="lazy" className={`object-cover ${className}`} />;
}

export function UpNextCard({ item }: { item: UpNextItem }) {
  return (
    <article className="w-[260px] overflow-hidden rounded-xl border border-border bg-surface">
      <Link href={`/show/${item.media_id}`} className="relative block">
        <Art src={still(item.still_path) ?? poster(item.poster_path, 'w500')}
             alt={item.show_title} className="h-[146px] w-full" />
        {item.never_started === 1 && (
          <span className="absolute left-2 top-2 rounded-md bg-accent px-1.5 py-0.5
                           text-[11px] font-semibold text-white">New</span>
        )}
        {item.runtime && (
          <span className="absolute bottom-2 right-2 rounded-md bg-black/70 px-1.5 py-0.5
                           text-[11px] font-medium text-white">{item.runtime}m</span>
        )}
      </Link>
      <div className="flex items-center gap-2 p-3">
        <Link href={`/show/${item.media_id}`} className="min-w-0 flex-1">
          <p className="truncate text-sm font-semibold">{item.show_title}</p>
          <p className="truncate text-xs text-muted">
            S{item.season} · E{item.number}
            {item.episode_title ? ` · ${item.episode_title}` : ''}
          </p>
          {item.remaining > 1 && (
            <p className="mt-0.5 text-[11px] text-muted">{item.remaining} to catch up</p>
          )}
        </Link>
        <MarkWatched mediaId={item.media_id} episodeId={item.episode_id} />
      </div>
    </article>
  );
}

export function AiringCard({ item }: { item: CalendarItem }) {
  const label = item.days_away <= 0 ? 'Today'
    : item.days_away === 1 ? 'Tomorrow'
    : new Date(item.air_date + 'T12:00:00').toLocaleDateString(undefined, { weekday: 'long' });
  const badge = item.is_premiere ? 'Premiere' : item.is_finale ? 'Finale' : null;
  return (
    <Link href={`/show/${item.media_id}`}
          className="block w-[190px] overflow-hidden rounded-xl border border-border bg-surface">
      <div className="relative">
        <Art src={still(item.still_path) ?? poster(item.poster_path, 'w342')}
             alt={item.show_title} className="h-[107px] w-full" />
        <span className="absolute bottom-2 left-2 rounded-md bg-black/70 px-1.5 py-0.5
                         text-[11px] font-medium text-white">{label}</span>
        {badge && (
          <span className="absolute right-2 top-2 rounded-md bg-accent px-1.5 py-0.5
                           text-[11px] font-semibold text-white">{badge}</span>
        )}
      </div>
      <div className="p-2.5">
        <p className="truncate text-sm font-semibold">{item.show_title}</p>
        <p className="truncate text-xs text-muted">
          S{item.season} · E{item.number}{item.episode_title ? ` · ${item.episode_title}` : ''}
        </p>
      </div>
    </Link>
  );
}
