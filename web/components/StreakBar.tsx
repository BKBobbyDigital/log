export default function StreakBar({
  length, days,
}: { length: number; days: { day: string; plays: number }[] }) {
  const max = Math.max(1, ...days.map(d => d.plays));
  return (
    <section className="px-4 py-3">
      <div className="flex items-center gap-4 rounded-xl border border-border bg-surface p-4">
        <div className="grid size-11 shrink-0 place-items-center rounded-full bg-accent-soft">
          <svg viewBox="0 0 24 24" className="size-6 text-accent" fill="currentColor">
            <path d="M12 2c.5 3.5-1.8 4.6-3.2 6.4A6.7 6.7 0 0 0 7.2 13a5 5 0 0 0 9.9 1c.3-2.3-.8-4.2-2-5.6-.4 1-1 1.6-1.8 1.9.6-2.9-.2-6-1.3-8.3Z" />
          </svg>
        </div>
        <div className="min-w-0 flex-1">
          <p className="text-[15px] font-semibold">{length.toLocaleString()}-day streak</p>
          <p className="text-xs text-muted">Keep it going</p>
        </div>
        <div className="flex h-9 items-end gap-1" aria-hidden>
          {days.map(d => (
            <div key={d.day} title={`${d.day}: ${d.plays}`}
                 className={`w-2 rounded-sm ${d.plays ? 'bg-accent' : 'bg-border'}`}
                 style={{ height: `${d.plays ? Math.max(22, (d.plays / max) * 100) : 12}%` }} />
          ))}
        </div>
      </div>
    </section>
  );
}
