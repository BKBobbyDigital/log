const BASE = 'https://image.tmdb.org/t/p';
export const poster = (p: string | null, size: 'w185' | 'w342' | 'w500' = 'w342') =>
  p ? `${BASE}/${size}${p}` : null;
export const still = (p: string | null, size: 'w300' | 'w780' = 'w300') =>
  p ? `${BASE}/${size}${p}` : null;

export function relativeAir(date: string, days: number): string {
  if (days <= 0) return 'Today';
  if (days === 1) return 'Tomorrow';
  if (days < 7) return `In ${days} days`;
  return new Date(date + 'T12:00:00').toLocaleDateString(undefined, { month: 'short', day: 'numeric' });
}
