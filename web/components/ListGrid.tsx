import Link from 'next/link';
import { poster } from '@/lib/tmdb';
import type { ListRow } from '@/lib/lists';

function when(date: string | null) {
  if (!date) return null;
  const days = Math.round((new Date(date + 'T12:00:00').getTime() - Date.now()) / 86400_000);
  if (days <= 0) return 'Today';
  if (days === 1) return 'Tomorrow';
  if (days < 7) return new Date(date + 'T12:00:00').toLocaleDateString(undefined, { weekday: 'long' });
  return new Date(date + 'T12:00:00').toLocaleDateString(undefined, { month: 'short', day: 'numeric' });
}

/** One line of context per card, different for each view — a return date is
 *  the point of Airing, a rating is the point of Finished. */
function context(item: ListRow): string | null {
  if (item.next_season !== null) return `S${item.next_season} · E${item.next_number}`;
  if (item.returns_on) return when(item.returns_on);
  if (item.my_rating) return `★ ${item.my_rating}`;
  if (item.plays > 1) return `${item.plays} plays`;
  return item.year ? String(item.year) : null;
}

export default function ListGrid({ items }: { items: ListRow[] }) {
  if (items.length === 0) {
    return <p className="px-4 py-8 text-sm text-muted">Nothing here.</p>;
  }
  return (
    <ul className="grid grid-cols-3 gap-3 px-4 sm:grid-cols-4 md:grid-cols-5">
      {items.map(item => {
        const art = poster(item.poster_path);
        return (
          <li key={`${item.type}-${item.media_id}`}>
            <Link href={`/${item.type === 'show' ? 'show' : 'movie'}/${item.media_id}`}
                  className="block">
              <div className="relative overflow-hidden rounded-xl border border-border bg-surface">
                {art
                  /* eslint-disable-next-line @next/next/no-img-element */
                  ? <img src={art} alt="" loading="lazy"
                         className="aspect-[2/3] w-full object-cover" />
                  : <div className="aspect-[2/3] w-full bg-border" />}
                <span className="absolute left-1.5 top-1.5 rounded bg-black/70 px-1.5 py-0.5
                                 text-[10px] font-semibold uppercase tracking-wide text-white">
                  {item.type === 'show' ? 'TV' : 'Film'}
                </span>
              </div>
              <p className="mt-1.5 truncate text-xs font-medium">{item.title}</p>
              <p className="truncate text-[11px] text-muted">{context(item) ?? ''}</p>
            </Link>
          </li>
        );
      })}
    </ul>
  );
}
