import Link from 'next/link';
import { LISTS, type ListSlug } from '@/lib/lists';
import type { Filter } from '@/lib/db';

const ORDER: ListSlug[] = [
  'up-next', 'airing', 'between-seasons', 'watchlist', 'finished', 'stopped',
];

export default function ListNav({
  active, counts, type,
}: { active?: ListSlug | 'history'; counts: Record<string, number>; type: Filter }) {
  const qs = type === 'all' ? '' : `?type=${type}`;
  return (
    <nav className="rail py-2">
      {ORDER.filter(slug => counts[slug] !== undefined).map(slug => (
        <Link key={slug} href={`/list/${slug}${qs}`}
          className={`whitespace-nowrap rounded-full px-3 py-1.5 text-sm font-medium transition ${
            active === slug
              ? 'bg-accent text-white'
              : 'border border-border bg-surface text-muted hover:text-foreground'}`}>
          {LISTS[slug].title}
          <span className="ml-1.5 opacity-70">{counts[slug]}</span>
        </Link>
      ))}
      <Link href={`/history${qs}`}
        className={`whitespace-nowrap rounded-full px-3 py-1.5 text-sm font-medium transition ${
          active === 'history'
            ? 'bg-accent text-white'
            : 'border border-border bg-surface text-muted hover:text-foreground'}`}>
        History
      </Link>
    </nav>
  );
}
