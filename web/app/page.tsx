import Link from 'next/link';
import { requireAuth } from '@/lib/auth';
import { getUpNext, getCalendar, getStreak, getRecentDays } from '@/lib/db';
import { getLibrary } from '@/lib/library';
import AppNav from '@/components/AppNav';
import StreakBar from '@/components/StreakBar';
import PosterCard from '@/components/PosterCard';
import { UpNextCard, AiringCard } from '@/components/NowCards';

export const dynamic = 'force-dynamic';

/** Now: the decision screen. What can I watch, what lands this week, what is
 *  waiting to be started. Everything else lives in Library or History. */
export default async function Now() {
  await requireAuth();

  const [upNext, calendar, streak, days, watchlist] = await Promise.all([
    getUpNext(),
    getCalendar(40),
    getStreak(),
    getRecentDays(),
    getLibrary({ status: 'watchlist', sort: 'added', limit: 20 }),
  ]);

  const thisWeek = calendar.filter(c => c.days_away <= 7);

  return (
    <main className="pb-20">
      <AppNav active="/" />

      <Section title="Up next" count={upNext.length}
               empty="You're caught up. Shows come back on their own when a new episode airs.">
        {upNext.map(i => <UpNextCard key={i.episode_id} item={i} />)}
      </Section>

      <Section title="This week" count={thisWeek.length}
               more={{ href: '/library?type=shows&status=watching', label: 'All' }}
               empty="Nothing airing in the next seven days.">
        {thisWeek.map(i => <AiringCard key={i.episode_id} item={i} />)}
      </Section>

      {streak && <StreakBar length={streak.length} days={days} />}

      <Section title="Want to watch" count={watchlist.length}
               more={{ href: '/library?status=watchlist', label: 'All' }}
               empty="Nothing on the watchlist.">
        {watchlist.map(i => (
          <div key={i.media_id} className="w-[124px]"><PosterCard item={i} /></div>
        ))}
      </Section>
    </main>
  );
}

function Section({
  title, count, children, empty, more,
}: {
  title: string; count: number; children: React.ReactNode; empty: string;
  more?: { href: string; label: string };
}) {
  return (
    <section className="py-3">
      <div className="mb-3 flex items-baseline gap-2 px-4">
        <h2 className="text-[17px] font-semibold tracking-tight">{title}</h2>
        {count > 0 && (
          <span className="rounded-full bg-accent-soft px-2 py-0.5 text-xs font-medium text-accent">
            {count}
          </span>
        )}
        {more && count > 0 && (
          <Link href={more.href} className="ml-auto text-sm text-muted hover:text-accent">
            {more.label}
          </Link>
        )}
      </div>
      {count > 0
        ? <div className="rail">{children}</div>
        : <p className="px-4 text-sm text-muted">{empty}</p>}
    </section>
  );
}
