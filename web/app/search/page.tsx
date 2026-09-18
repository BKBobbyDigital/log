import Link from 'next/link';
import { searchTmdb, annotateLibrary } from '@/lib/tmdbApi';
import { poster } from '@/lib/tmdb';
import AddToLibrary from '@/components/AddToLibrary';
import { requireAuth } from '@/lib/auth';

export const dynamic = 'force-dynamic';

export default async function SearchPage({
  searchParams,
}: { searchParams: Promise<{ q?: string }> }) {
  await requireAuth();
  const { q } = await searchParams;
  const query = (q ?? '').trim();
  const hits = query ? await annotateLibrary(await searchTmdb(query)) : [];

  return (
    <main className="pb-20">
      <header className="flex items-center gap-3 px-4 pt-4">
        <Link href="/" className="text-sm text-muted hover:text-accent">← Home</Link>
        <h1 className="text-lg font-bold">Search</h1>
      </header>

      <form action="/search" className="px-4 pt-3">
        <input name="q" defaultValue={query} autoFocus placeholder="Search films and TV…"
          className="w-full rounded-xl border border-border bg-surface px-4 py-2.5 text-sm
                     outline-none placeholder:text-muted focus:border-accent" />
      </form>

      {query && hits.length === 0 && (
        <p className="px-4 pt-6 text-sm text-muted">Nothing found for “{query}”.</p>
      )}

      <ul className="px-4 pt-4">
        {hits.map(h => (
          <li key={`${h.type}-${h.tmdb_id}`}
              className="flex gap-3 border-b border-border py-3 last:border-0">
            {poster(h.poster_path, 'w185')
              /* eslint-disable-next-line @next/next/no-img-element */
              ? <img src={poster(h.poster_path, 'w185')!} alt=""
                     className="h-[84px] w-[56px] shrink-0 rounded-md object-cover" />
              : <div className="h-[84px] w-[56px] shrink-0 rounded-md bg-border" />}
            <div className="min-w-0 flex-1">
              <p className="truncate text-sm font-semibold">{h.title}</p>
              <p className="text-xs text-muted">
                {h.type === 'show' ? 'TV' : 'Film'}
                {h.year ? ` · ${h.year}` : ''}
                {h.tmdb_rating ? ` · ★ ${h.tmdb_rating.toFixed(1)}` : ''}
              </p>
              {h.overview && (
                <p className="mt-1 line-clamp-2 text-xs leading-relaxed text-muted">{h.overview}</p>
              )}
            </div>
            <div className="shrink-0 self-center">
              <AddToLibrary tmdbId={h.tmdb_id} type={h.type} inLibrary={h.in_library} />
            </div>
          </li>
        ))}
      </ul>
    </main>
  );
}
