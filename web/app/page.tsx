import {
  getUpNext, getCalendar, getWatchlist, getRevived,
  getStreak, getRecentDays, getStats, type Filter,
} from '@/lib/db';
import Link from 'next/link';
import Rail from '@/components/Rail';
import { UpNextCard, CalendarCard, WatchlistCard } from '@/components/Cards';
import StreakBar from '@/components/StreakBar';
import Revived from '@/components/Revived';
import FilterTabs from '@/components/FilterTabs';
import ListNav from '@/components/ListNav';
import { allCounts } from '@/lib/lists';
import { requireAuth } from '@/lib/auth';

// reads the DB on every request; server actions revalidate this path
export const dynamic = 'force-dynamic';

export default async function Home({
  searchParams,
}: { searchParams: Promise<{ filter?: string }> }) {
  await requireAuth();
  const { filter: raw } = await searchParams;
  const filter: Filter = raw === 'shows' || raw === 'movies' ? raw : 'all';
  const showTV = filter !== 'movies';

  const upNext = showTV ? await getUpNext() : [];
  const calendar = showTV ? await getCalendar() : [];
  const watchlist = await getWatchlist(filter);
  const revived = showTV ? await getRevived() : [];
  const streak = await getStreak();
  const days = await getRecentDays();
  const stats = await getStats();
  const counts = await allCounts(filter);

  return (
    <main>
      <header className="sticky top-0 z-10 border-b border-border bg-background/85 backdrop-blur">
        <div className="flex items-center gap-3 px-4 py-3">
        <h1 className="text-lg font-bold tracking-tight">LOG</h1>
        <div className="ml-auto flex items-center gap-2">
          <FilterTabs active={filter} />
          <Link href="/search" aria-label="Search"
            className="grid size-9 place-items-center rounded-full border border-border
                       bg-surface text-muted hover:border-accent hover:text-accent">
            <svg viewBox="0 0 24 24" className="size-4" fill="none" stroke="currentColor"
                 strokeWidth={2.2} strokeLinecap="round">
              <circle cx="11" cy="11" r="7" /><path d="m20 20-3.5-3.5" />
            </svg>
          </Link>
        </div>
        </div>
        <ListNav counts={counts} type={filter} />
      </header>

      {revived.length > 0 && <Revived items={revived} />}

      <Rail title="Up Next" count={upNext.length}
            empty={showTV
              ? "You're caught up on everything. Shows come back on their own when a new episode airs."
              : 'Switch to Shows or Media to see episodes.'}>
        {upNext.map(i => <UpNextCard key={i.episode_id} item={i} />)}
      </Rail>

      {streak && <StreakBar length={streak.length} days={days} />}

      <Rail title="Calendar" count={calendar.length}
            empty="Nothing scheduled for the shows you're watching.">
        {calendar.map(i => <CalendarCard key={i.episode_id} item={i} />)}
      </Rail>

      <Rail title="Watchlist" count={watchlist.length} empty="Nothing on the watchlist.">
        {watchlist.map(i => <WatchlistCard key={i.media_id} item={i} />)}
      </Rail>

      <footer className="px-4 py-6 text-xs text-muted">
        {stats.episodes.toLocaleString()} episodes · {stats.movies.toLocaleString()} movies ·{' '}
        {stats.watching} watching · {stats.watchlist} on the watchlist
      </footer>
    </main>
  );
}
