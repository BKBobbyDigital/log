import Link from 'next/link';

/** Three destinations. The app is a queue, an archive, and a log. */
const TABS = [
  { href: '/', label: 'Now' },
  { href: '/library', label: 'Library' },
  { href: '/history', label: 'History' },
];

export default function AppNav({ active }: { active: string }) {
  return (
    <header className="sticky top-0 z-20 border-b border-border bg-background/85 backdrop-blur">
      <div className="flex items-center gap-4 px-4 py-3">
        <span className="text-lg font-bold tracking-tight">LOG</span>
        <nav className="flex gap-1">
          {TABS.map(t => (
            <Link key={t.href} href={t.href}
              className={`rounded-full px-3 py-1.5 text-sm font-medium transition ${
                active === t.href
                  ? 'bg-accent text-white'
                  : 'text-muted hover:text-foreground'}`}>
              {t.label}
            </Link>
          ))}
        </nav>
      </div>
    </header>
  );
}
