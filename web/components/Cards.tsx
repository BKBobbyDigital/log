import Link from 'next/link';
import { poster, still, relativeAir } from '@/lib/tmdb';
import type { UpNextItem, CalendarItem, WatchlistItem } from '@/lib/db';
import MarkWatched from './MarkWatched';

const ep = (s: number, n: number) => `S${s} · E${n}`;

function Art({ src, alt, className = '' }: { src: string | null; alt: string; className?: string }) {
  if (!src) {
    return (
      <div className={`grid place-items-center bg-border text-muted ${className}`}>
        <svg viewBox="0 0 24 24" className="size-7 opacity-50" fill="none"
             stroke="currentColor" strokeWidth={1.5}>
          <rect x="3" y="4" width="18" height="16" rx="2" />
          <path d="M3 9h18M8 4v5M16 4v5" />
        </svg>
      </div>
    );
  }
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
          <span className="absolute left-2 top-2 rounded-md bg-accent px-1.5 py-0.5 text-[11px] font-semibold text-white">
            New
          </span>
        )}
        {item.runtime && (
          <span className="absolute bottom-2 right-2 rounded-md bg-black/70 px-1.5 py-0.5 text-[11px] font-medium text-white">
            {item.runtime}m
          </span>
        )}
      </Link>
      <div className="flex items-center gap-2 p-3">
        <Link href={`/show/${item.media_id}`} className="min-w-0 flex-1">
          <p className="truncate text-sm font-semibold">{item.show_title}</p>
          <p className="truncate text-xs text-muted">
            {ep(item.season, item.number)}
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

export function CalendarCard({ item }: { item: CalendarItem }) {
  const badge = item.is_premiere ? 'Premiere' : item.is_finale ? 'Finale' : null;
  return (
    <Link href={`/show/${item.media_id}`}
          className="block w-[190px] overflow-hidden rounded-xl border border-border bg-surface">
      <div className="relative">
        <Art src={still(item.still_path) ?? poster(item.poster_path, 'w342')}
             alt={item.show_title} className="h-[107px] w-full" />
        <span className="absolute bottom-2 left-2 rounded-md bg-black/70 px-1.5 py-0.5 text-[11px] font-medium text-white">
          {relativeAir(item.air_date, item.days_away)}
        </span>
        {badge && (
          <span className="absolute right-2 top-2 rounded-md bg-accent px-1.5 py-0.5 text-[11px] font-semibold text-white">
            {badge}
          </span>
        )}
      </div>
      <div className="p-2.5">
        <p className="truncate text-sm font-semibold">{item.show_title}</p>
        <p className="truncate text-xs text-muted">
          {ep(item.season, item.number)}
          {item.episode_title ? ` · ${item.episode_title}` : ''}
        </p>
      </div>
    </Link>
  );
}

export function WatchlistCard({ item }: { item: WatchlistItem }) {
  return (
    <Link href={`/${item.type === 'show' ? 'show' : 'movie'}/${item.media_id}`}
          className="block w-[124px]">
      <div className="relative overflow-hidden rounded-xl border border-border bg-surface">
        <Art src={poster(item.poster_path)} alt={item.title} className="h-[186px] w-full" />
        <span className="absolute left-1.5 top-1.5 rounded bg-black/70 px-1.5 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-white">
          {item.type === 'show' ? 'TV' : 'Film'}
        </span>
      </div>
      <p className="mt-1.5 truncate text-xs font-medium">{item.title}</p>
      <p className="truncate text-[11px] text-muted">{item.year ?? ''}</p>
    </Link>
  );
}
