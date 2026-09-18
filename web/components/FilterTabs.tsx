import Link from 'next/link';
import type { Filter } from '@/lib/db';

const TABS: { key: Filter; label: string }[] = [
  { key: 'all', label: 'Media' },
  { key: 'shows', label: 'Shows' },
  { key: 'movies', label: 'Movies' },
];

export default function FilterTabs({ active }: { active: Filter }) {
  return (
    <nav className="flex gap-1 rounded-full border border-border bg-surface p-1">
      {TABS.map(t => (
        <Link key={t.key} href={t.key === 'all' ? '/' : `/?filter=${t.key}`}
          className={`rounded-full px-3.5 py-1.5 text-sm font-medium transition ${
            active === t.key ? 'bg-accent text-white' : 'text-muted hover:text-foreground'}`}>
          {t.label}
        </Link>
      ))}
    </nav>
  );
}
