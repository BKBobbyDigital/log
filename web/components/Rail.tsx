import Link from 'next/link';

export default function Rail({
  title, count, href, children, empty,
}: {
  title: string; count?: number; href?: string;
  children: React.ReactNode; empty?: string;
}) {
  const hasChildren = Array.isArray(children) ? children.length > 0 : Boolean(children);
  return (
    <section className="py-3">
      <div className="mb-3 flex items-baseline gap-2 px-4">
        <h2 className="text-[17px] font-semibold tracking-tight">{title}</h2>
        {count !== undefined && count > 0 && (
          <span className="rounded-full bg-accent-soft px-2 py-0.5 text-xs font-medium text-accent">
            {count}
          </span>
        )}
        {href && hasChildren && (
          <Link href={href} className="ml-auto text-sm text-muted hover:text-accent">All</Link>
        )}
      </div>
      {hasChildren
        ? <div className="rail">{children}</div>
        : <p className="px-4 text-sm text-muted">{empty}</p>}
    </section>
  );
}
