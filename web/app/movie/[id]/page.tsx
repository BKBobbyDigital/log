import Link from 'next/link';
import { notFound } from 'next/navigation';
import { getMedia, getPlays, getRating, LOCAL_TZ } from '@/lib/db';
import { poster } from '@/lib/tmdb';
import StatusControl from '@/components/StatusControl';
import RatingControl from '@/components/RatingControl';
import { MarkMovie, RemovePlay } from '@/components/MovieActions';
import { requireAuth } from '@/lib/auth';

export const dynamic = 'force-dynamic';

export default async function MoviePage({ params }: { params: Promise<{ id: string }> }) {
  await requireAuth();
  const { id } = await params;
  const media = await getMedia(Number(id));
  if (!media || media.type !== 'movie') notFound();

  const plays = await getPlays(media.id);
  const rating = await getRating(media.id);

  return (
    <main className="pb-20">
      <header className="flex gap-4 px-4 pt-4">
        {poster(media.poster_path, 'w185') && (
          /* eslint-disable-next-line @next/next/no-img-element */
          <img src={poster(media.poster_path, 'w185')!} alt=""
               className="h-[150px] w-[100px] shrink-0 rounded-lg object-cover" />
        )}
        <div className="min-w-0 flex-1">
          <Link href="/" className="text-sm text-muted hover:text-accent">← Home</Link>
          <h1 className="mt-1 text-xl font-bold leading-tight">{media.title}</h1>
          <p className="text-sm text-muted">
            {media.year}
            {media.runtime ? ` · ${media.runtime}m` : ''}
            {media.tmdb_rating ? ` · ★ ${media.tmdb_rating.toFixed(1)}` : ''}
          </p>
          <div className="mt-3"><StatusControl mediaId={media.id} status={media.status} /></div>
        </div>
      </header>

      <section className="px-4 pt-5">
        <MarkMovie mediaId={media.id} plays={plays.length} tz={LOCAL_TZ} />
      </section>

      {media.overview && (
        <p className="px-4 pt-5 text-sm leading-relaxed text-muted">{media.overview}</p>
      )}

      <section className="px-4 pt-5">
        <p className="mb-2 text-xs font-medium uppercase tracking-wide text-muted">Your rating</p>
        <RatingControl mediaId={media.id} rating={rating} />
      </section>

      {plays.length > 0 && (
        <section className="px-4 pt-6">
          <h2 className="mb-2 text-base font-semibold">History</h2>
          <ul className="text-sm">
            {plays.map(p => (
              <li key={p.id} className="flex items-center gap-3 border-b border-border py-2 last:border-0">
                <span className="flex-1">{p.local_day ?? p.watched_at.slice(0, 10)}</span>
                {p.is_backfill === 1 && (
                  <span className="rounded bg-border px-1.5 py-0.5 text-[11px] text-muted">
                    imported
                  </span>
                )}
                <RemovePlay watchId={p.id} />
              </li>
            ))}
          </ul>
        </section>
      )}
    </main>
  );
}
