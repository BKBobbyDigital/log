import Link from 'next/link';
import { poster } from '@/lib/tmdb';
import { situation, type LibraryItem } from '@/lib/library';

/** One card shape everywhere. The second line is the title's situation —
 *  derived, never stored, never a prompt. */
export default function PosterCard({ item }: { item: LibraryItem }) {
  const art = poster(item.poster_path);
  const note = situation(item);
  return (
    <Link href={`/${item.type === 'show' ? 'show' : 'movie'}/${item.media_id}`} className="block">
      <div className="relative overflow-hidden rounded-xl border border-border bg-surface">
        {art
          /* eslint-disable-next-line @next/next/no-img-element */
          ? <img src={art} alt="" loading="lazy" className="aspect-[2/3] w-full object-cover" />
          : <div className="aspect-[2/3] w-full bg-border" />}
        <span className="absolute left-1.5 top-1.5 rounded bg-black/70 px-1.5 py-0.5
                         text-[10px] font-semibold uppercase tracking-wide text-white">
          {item.type === 'show' ? 'TV' : 'Film'}
        </span>
      </div>
      <p className="mt-1.5 truncate text-xs font-medium">{item.title}</p>
      <p className="truncate text-[11px] text-muted">{note ?? item.year ?? ''}</p>
    </Link>
  );
}
