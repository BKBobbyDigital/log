import Link from 'next/link';
import { requireAuth } from '@/lib/auth';
import { getHistory, countHistory, type HistoryRow } from '@/lib/library';
import { poster } from '@/lib/tmdb';
import type { TypeFilter } from '@/lib/library';
import AppNav from '@/components/AppNav';

export const dynamic = 'force-dynamic';

const PAGE = 100;

function dayLabel(day: string) {
  const d = new Date(day + 'T12:00:00');
  const today = new Date();
  const diff = Math.round((today.setHours(12, 0, 0, 0) - d.getTime()) / 86400_000);
  if (diff === 0) return 'Today';
  if (diff === 1) return 'Yesterday';
  return d.toLocaleDateString(undefined, {
    weekday: 'short', month: 'short', day: 'numeric',
    year: d.getFullYear() === today.getFullYear() ? undefined : 'numeric',
  });
}

function groupByDay(rows: HistoryRow[]) {
  const out: { day: string; rows: HistoryRow[] }[] = [];
  for (const r of rows) {
    const day = r.local_day ?? r.watched_at.slice(0, 10);
    const last = out[out.length - 1];
    if (last && last.day === day) last.rows.push(r);
    else out.push({ day, rows: [r] });
  }
  return out;
}

export default async function HistoryPage({
  searchParams,
}: { searchParams: Promise<{ type?: string; all?: string; offset?: string }> }) {
  await requireAuth();
  const sp = await searchParams;
  const type: TypeFilter = sp.type === 'shows' || sp.type === 'movies' ? sp.type : 'all';
  const includeBackfill = sp.all === '1';
  const offset = Math.max(0, Number(sp.offset ?? 0) || 0);

  const [rows, total] = await Promise.all([
    getHistory(type, includeBackfill, PAGE, offset),
    countHistory(type, includeBackfill),
  ]);
  const days = groupByDay(rows);

  const qs = (over: Record<string, string>) => {
    const p = new URLSearchParams();
    if (type !== 'all') p.set('type', type);
    if (includeBackfill) p.set('all', '1');
    for (const [k, v] of Object.entries(over)) v ? p.set(k, v) : p.delete(k);
    const s = p.toString();
    return s ? `?${s}` : '';
  };

  return (
    <main className="pb-20">
      <AppNav active="/history" />

      <div className="flex items-baseline gap-3 px-4 pt-4">
        <div>
          <h1 className="text-xl font-bold tracking-tight">History</h1>
          <p className="mt-0.5 text-sm text-muted">
            {total.toLocaleString()} plays
            {!includeBackfill && ' with real timestamps'}
          </p>
        </div>
        <Link href={`/history${qs({ all: includeBackfill ? '' : '1', offset: '' })}`}
          className="ml-auto whitespace-nowrap rounded-full border border-border bg-surface
                     px-3 py-1.5 text-xs font-medium text-muted hover:text-foreground">
          {includeBackfill ? 'Hide imported' : 'Include imported'}
        </Link>
      </div>

      {days.map(({ day, rows }) => (
        <section key={day} className="pt-5">
          <h2 className="sticky top-[56px] z-[5] bg-background/90 px-4 py-1 text-xs
                         font-semibold uppercase tracking-wide text-muted backdrop-blur">
            {dayLabel(day)} <span className="font-normal normal-case">· {rows.length}</span>
          </h2>
          <ul className="px-4">
            {rows.map(r => {
              const art = poster(r.poster_path, 'w185');
              return (
                <li key={r.id} className="border-b border-border last:border-0">
                  <Link href={`/${r.type === 'show' ? 'show' : 'movie'}/${r.media_id}`}
                        className="flex items-center gap-3 py-2">
                    {art
                      /* eslint-disable-next-line @next/next/no-img-element */
                      ? <img src={art} alt="" loading="lazy"
                             className="h-14 w-10 shrink-0 rounded object-cover" />
                      : <div className="h-14 w-10 shrink-0 rounded bg-border" />}
                    <div className="min-w-0 flex-1">
                      <p className="truncate text-sm font-medium">{r.title}</p>
                      <p className="truncate text-xs text-muted">
                        {r.season !== null
                          ? `S${r.season} · E${r.number}${r.episode_title ? ` · ${r.episode_title}` : ''}`
                          : 'Film'}
                      </p>
                    </div>
                    {r.is_backfill === 1 && (
                      <span className="shrink-0 rounded bg-border px-1.5 py-0.5 text-[10px] text-muted">
                        imported
                      </span>
                    )}
                  </Link>
                </li>
              );
            })}
          </ul>
        </section>
      ))}

      {rows.length === 0 && <p className="px-4 py-8 text-sm text-muted">Nothing logged yet.</p>}

      {offset + PAGE < total && (
        <div className="px-4 pt-6">
          <Link href={`/history${qs({ offset: String(offset + PAGE) })}`}
            className="block rounded-xl border border-border bg-surface px-4 py-2.5
                       text-center text-sm font-medium hover:border-accent hover:text-accent">
            Show more ({(total - offset - PAGE).toLocaleString()} left)
          </Link>
        </div>
      )}
    </main>
  );
}
