import Link from 'next/link';
import { notFound } from 'next/navigation';
import { requireAuth } from '@/lib/auth';
import { LISTS, getList, countList, allCounts, type ListSlug, type SortKey } from '@/lib/lists';
import type { Filter } from '@/lib/db';
import ListGrid from '@/components/ListGrid';
import ListNav from '@/components/ListNav';

export const dynamic = 'force-dynamic';

const PAGE = 60;
const SORTS: { key: SortKey; label: string }[] = [
  { key: 'recent', label: 'Recent' },
  { key: 'title', label: 'Title' },
  { key: 'year', label: 'Year' },
  { key: 'rating', label: 'My rating' },
  { key: 'runtime', label: 'Runtime' },
];

export default async function ListPage({
  params, searchParams,
}: {
  params: Promise<{ slug: string }>;
  searchParams: Promise<{ type?: string; sort?: string; offset?: string }>;
}) {
  await requireAuth();
  const { slug } = await params;
  if (!(slug in LISTS)) notFound();
  const key = slug as ListSlug;
  const def = LISTS[key];

  const sp = await searchParams;
  const type: Filter = sp.type === 'shows' || sp.type === 'movies' ? sp.type : 'all';
  const sort = (SORTS.some(s => s.key === sp.sort) ? sp.sort : def.defaultSort) as SortKey;
  const offset = Math.max(0, Number(sp.offset ?? 0) || 0);

  const [items, total, counts] = await Promise.all([
    getList(key, type, sort, PAGE, offset),
    countList(key, type),
    allCounts(type),
  ]);

  const qs = (over: Record<string, string>) => {
    const p = new URLSearchParams();
    if (type !== 'all') p.set('type', type);
    if (sort !== def.defaultSort) p.set('sort', sort);
    for (const [k, v] of Object.entries(over)) v ? p.set(k, v) : p.delete(k);
    const s = p.toString();
    return s ? `?${s}` : '';
  };

  return (
    <main className="pb-20">
      <header className="sticky top-0 z-10 border-b border-border bg-background/85 backdrop-blur">
        <div className="flex items-center gap-3 px-4 py-3">
          <Link href="/" className="text-lg font-bold tracking-tight">LOG</Link>
          <div className="ml-auto flex gap-1 rounded-full border border-border bg-surface p-1">
            {(['all', 'shows', 'movies'] as Filter[]).map(t => (
              <Link key={t}
                href={`/list/${def.showsOnly && t === 'movies' ? 'finished' : key}${
                  t === 'all' ? '' : `?type=${t}`}`}
                className={`rounded-full px-3 py-1 text-sm font-medium ${
                  type === t ? 'bg-accent text-white' : 'text-muted hover:text-foreground'}`}>
                {t === 'all' ? 'Media' : t === 'shows' ? 'Shows' : 'Movies'}
              </Link>
            ))}
          </div>
        </div>
        <ListNav active={key} counts={counts} type={type} />
      </header>

      <div className="px-4 pt-4">
        <h1 className="text-xl font-bold tracking-tight">{def.title}</h1>
        <p className="mt-0.5 text-sm text-muted">
          {def.blurb} {total.toLocaleString()} {total === 1 ? 'title' : 'titles'}.
        </p>
      </div>

      <div className="rail py-3">
        {SORTS.map(s => (
          <Link key={s.key} href={`/list/${key}${qs({ sort: s.key === def.defaultSort ? '' : s.key, offset: '' })}`}
            className={`whitespace-nowrap rounded-full px-2.5 py-1 text-xs font-medium ${
              sort === s.key ? 'bg-accent-soft text-accent' : 'text-muted hover:text-foreground'}`}>
            {s.label}
          </Link>
        ))}
      </div>

      <ListGrid items={items} />

      {offset + PAGE < total && (
        <div className="px-4 pt-6">
          <Link href={`/list/${key}${qs({ offset: String(offset + PAGE) })}`}
            className="block rounded-xl border border-border bg-surface px-4 py-2.5
                       text-center text-sm font-medium hover:border-accent hover:text-accent">
            Show more ({(total - offset - PAGE).toLocaleString()} left)
          </Link>
        </div>
      )}
      {offset > 0 && (
        <div className="px-4 pt-2">
          <Link href={`/list/${key}${qs({ offset: String(Math.max(0, offset - PAGE)) })}`}
            className="block text-center text-sm text-muted hover:text-accent">Back</Link>
        </div>
      )}
    </main>
  );
}
