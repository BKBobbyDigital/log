import Link from 'next/link';
import { requireAuth } from '@/lib/auth';
import {
  getLibrary, countLibrary, statusCounts,
  type TypeFilter, type StatusFilter, type Sort,
} from '@/lib/library';
import { searchTmdb, annotateLibrary } from '@/lib/tmdbApi';
import { poster } from '@/lib/tmdb';
import AppNav from '@/components/AppNav';
import PosterCard from '@/components/PosterCard';
import AddToLibrary from '@/components/AddToLibrary';

export const dynamic = 'force-dynamic';
const PAGE = 60;

const STATUSES: { key: StatusFilter; label: string }[] = [
  { key: 'all', label: 'All' },
  { key: 'watching', label: 'Watching' },
  { key: 'watchlist', label: 'Want to watch' },
  { key: 'watched', label: 'Finished' },
  { key: 'stopped', label: 'Stopped' },
];
const SORTS: { key: Sort; label: string }[] = [
  { key: 'recent', label: 'Recently watched' },
  { key: 'added', label: 'Recently added' },
  { key: 'title', label: 'Title' },
  { key: 'year', label: 'Year' },
  { key: 'rating', label: 'My rating' },
];

/** Library: everything, one set of filters, and one search box.
 *
 *  Searching looks in your own titles first and offers TMDB results
 *  underneath — "find what I have" and "add what I don't" are the same
 *  gesture, so they are the same box. */
export default async function Library({
  searchParams,
}: {
  searchParams: Promise<{ q?: string; type?: string; status?: string; sort?: string; offset?: string }>;
}) {
  await requireAuth();
  const sp = await searchParams;
  const search = (sp.q ?? '').trim();
  const type = (['shows', 'movies'].includes(sp.type ?? '') ? sp.type : 'all') as TypeFilter;
  const status = (STATUSES.some(s => s.key === sp.status) ? sp.status : 'all') as StatusFilter;
  const sort = (SORTS.some(s => s.key === sp.sort) ? sp.sort : (search ? 'title' : 'recent')) as Sort;
  const offset = Math.max(0, Number(sp.offset ?? 0) || 0);

  const [items, total, counts] = await Promise.all([
    getLibrary({ q: search, type, status, sort, limit: PAGE, offset }),
    countLibrary({ q: search, type, status }),
    statusCounts(type, search),
  ]);

  // only reach for TMDB when searching, and only to offer things you lack
  const adds = search
    ? (await annotateLibrary(await searchTmdb(search))).filter(h => !h.in_library).slice(0, 8)
    : [];

  const url = (over: Record<string, string>) => {
    const p = new URLSearchParams();
    if (search) p.set('q', search);
    if (type !== 'all') p.set('type', type);
    if (status !== 'all') p.set('status', status);
    if (sp.sort) p.set('sort', sp.sort);
    for (const [k, v] of Object.entries(over)) v ? p.set(k, v) : p.delete(k);
    const s = p.toString();
    return `/library${s ? `?${s}` : ''}`;
  };

  return (
    <main className="pb-20">
      <AppNav active="/library" />

      <form action="/library" className="px-4 pt-4">
        {type !== 'all' && <input type="hidden" name="type" value={type} />}
        {status !== 'all' && <input type="hidden" name="status" value={status} />}
        <input name="q" defaultValue={search} placeholder="Search your library, or add something new…"
          className="w-full rounded-xl border border-border bg-surface px-4 py-2.5 text-sm
                     outline-none placeholder:text-muted focus:border-accent" />
      </form>

      <div className="rail py-3">
        {(['all', 'shows', 'movies'] as TypeFilter[]).map(t => (
          <Link key={t} href={url({ type: t === 'all' ? '' : t, offset: '' })}
            className={`whitespace-nowrap rounded-full px-3 py-1.5 text-sm font-medium ${
              type === t ? 'bg-accent text-white'
                         : 'border border-border bg-surface text-muted hover:text-foreground'}`}>
            {t === 'all' ? 'Everything' : t === 'shows' ? 'TV' : 'Films'}
          </Link>
        ))}
        <span className="w-2" />
        {STATUSES.map(s => (
          <Link key={s.key} href={url({ status: s.key === 'all' ? '' : s.key, offset: '' })}
            className={`whitespace-nowrap rounded-full px-3 py-1.5 text-sm font-medium ${
              status === s.key ? 'bg-accent text-white'
                               : 'border border-border bg-surface text-muted hover:text-foreground'}`}>
            {s.label}
            <span className="ml-1.5 opacity-70">
              {s.key === 'all' ? counts.all ?? 0 : counts[s.key] ?? 0}
            </span>
          </Link>
        ))}
      </div>

      <div className="flex items-baseline gap-2 px-4">
        <p className="text-sm text-muted">
          {total.toLocaleString()} {total === 1 ? 'title' : 'titles'}
          {search && ` matching “${search}”`}
        </p>
        <div className="ml-auto flex gap-1 overflow-x-auto">
          {SORTS.map(s => (
            <Link key={s.key} href={url({ sort: s.key, offset: '' })}
              className={`whitespace-nowrap rounded-full px-2 py-1 text-[11px] font-medium ${
                sort === s.key ? 'bg-accent-soft text-accent' : 'text-muted hover:text-foreground'}`}>
              {s.label}
            </Link>
          ))}
        </div>
      </div>

      {items.length > 0 ? (
        <ul className="grid grid-cols-3 gap-3 px-4 pt-3 sm:grid-cols-4 md:grid-cols-5">
          {items.map(i => <li key={`${i.type}-${i.media_id}`}><PosterCard item={i} /></li>)}
        </ul>
      ) : (
        <p className="px-4 pt-6 text-sm text-muted">
          {search ? 'Nothing in your library matches.' : 'Nothing here.'}
        </p>
      )}

      {offset + PAGE < total && (
        <div className="px-4 pt-6">
          <Link href={url({ offset: String(offset + PAGE) })}
            className="block rounded-xl border border-border bg-surface px-4 py-2.5
                       text-center text-sm font-medium hover:border-accent hover:text-accent">
            Show more ({(total - offset - PAGE).toLocaleString()} left)
          </Link>
        </div>
      )}

      {adds.length > 0 && (
        <section className="px-4 pt-8">
          <h2 className="text-sm font-semibold">Add from TMDB</h2>
          <ul className="pt-2">
            {adds.map(h => (
              <li key={`${h.type}-${h.tmdb_id}`}
                  className="flex gap-3 border-b border-border py-3 last:border-0">
                {poster(h.poster_path, 'w185')
                  /* eslint-disable-next-line @next/next/no-img-element */
                  ? <img src={poster(h.poster_path, 'w185')!} alt=""
                         className="h-[72px] w-12 shrink-0 rounded object-cover" />
                  : <div className="h-[72px] w-12 shrink-0 rounded bg-border" />}
                <div className="min-w-0 flex-1">
                  <p className="truncate text-sm font-medium">{h.title}</p>
                  <p className="text-xs text-muted">
                    {h.type === 'show' ? 'TV' : 'Film'}{h.year ? ` · ${h.year}` : ''}
                    {h.tmdb_rating ? ` · ★ ${h.tmdb_rating.toFixed(1)}` : ''}
                  </p>
                </div>
                <div className="shrink-0 self-center">
                  <AddToLibrary tmdbId={h.tmdb_id} type={h.type} inLibrary={h.in_library} />
                </div>
              </li>
            ))}
          </ul>
        </section>
      )}
    </main>
  );
}
