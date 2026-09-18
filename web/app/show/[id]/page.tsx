import Link from 'next/link';
import { notFound } from 'next/navigation';
import {
  getMedia, getSeasons, getEpisodes, getShowProgress, getRating, LOCAL_TZ,
} from '@/lib/db';
import { poster } from '@/lib/tmdb';
import StatusControl from '@/components/StatusControl';
import RatingControl from '@/components/RatingControl';
import EpisodeRow from '@/components/EpisodeRow';
import MarkSeason from '@/components/MarkSeason';
import { requireAuth } from '@/lib/auth';

export const dynamic = 'force-dynamic';

export default async function ShowPage({
  params, searchParams,
}: { params: Promise<{ id: string }>; searchParams: Promise<{ season?: string }> }) {
  await requireAuth();
  const { id } = await params;
  const media = await getMedia(Number(id));
  if (!media || media.type !== 'show') notFound();

  const seasons = (await getSeasons(media.id)).filter(s => s.episodes > 0);
  const { season: rawSeason } = await searchParams;
  // default to the earliest season with something unwatched, else the last
  const defaultSeason =
    seasons.find(s => s.watched < s.aired)?.season ??
    seasons[seasons.length - 1]?.season ?? 1;
  const season = rawSeason !== undefined ? Number(rawSeason) : defaultSeason;

  const episodes = await getEpisodes(media.id, season);
  const progress = await getShowProgress(media.id);
  const rating = await getRating(media.id);
  const pct = progress.aired ? Math.round((progress.watched / progress.aired) * 100) : 0;
  const seasonPending = episodes.filter(
    e => e.plays === 0 && e.air_date !== null && e.air_date <= new Date().toISOString().slice(0, 10),
  ).length;

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
            {media.show_status ? ` · ${media.show_status}` : ''}
            {media.tmdb_rating ? ` · ★ ${media.tmdb_rating.toFixed(1)}` : ''}
          </p>
          <div className="mt-3"><StatusControl mediaId={media.id} status={media.status} /></div>
        </div>
      </header>

      <section className="px-4 pt-4">
        <div className="flex items-baseline justify-between text-sm">
          <span className="font-medium">{progress.watched} / {progress.aired} aired</span>
          <span className="text-muted">
            {pct}%{progress.plays > progress.watched ? ` · ${progress.plays} plays` : ''}
          </span>
        </div>
        <div className="mt-1.5 h-1.5 overflow-hidden rounded-full bg-border">
          <div className="h-full rounded-full bg-accent" style={{ width: `${pct}%` }} />
        </div>
        {progress.gaps > 0 && (
          <p className="mt-2 text-xs text-muted">
            {progress.gaps} skipped episode{progress.gaps === 1 ? '' : 's'} behind your progress
          </p>
        )}
      </section>

      {media.overview && (
        <p className="px-4 pt-4 text-sm leading-relaxed text-muted">{media.overview}</p>
      )}

      <section className="px-4 pt-5">
        <p className="mb-2 text-xs font-medium uppercase tracking-wide text-muted">Your rating</p>
        <RatingControl mediaId={media.id} rating={rating} />
      </section>

      <section className="pt-5">
        <div className="rail pb-1">
          {seasons.map(s => (
            <Link key={s.season} href={`/show/${media.id}?season=${s.season}`}
              className={`rounded-full px-3 py-1.5 text-sm font-medium whitespace-nowrap transition ${
                s.season === season
                  ? 'bg-accent text-white'
                  : 'border border-border bg-surface text-muted hover:text-foreground'}`}>
              {s.season === 0 ? 'Specials' : `Season ${s.season}`}
              <span className="ml-1.5 opacity-70">{s.watched}/{s.aired}</span>
            </Link>
          ))}
        </div>

        <div className="mt-3 flex items-center justify-between px-4">
          <h2 className="text-base font-semibold">
            {season === 0 ? 'Specials' : `Season ${season}`}
          </h2>
          <MarkSeason mediaId={media.id} season={season} pending={seasonPending} />
        </div>

        <ul className="mt-1 px-4">
          {episodes.map(ep => (
            <EpisodeRow key={ep.id} mediaId={media.id} ep={ep} tz={LOCAL_TZ} />
          ))}
        </ul>
      </section>
    </main>
  );
}
