import 'server-only';

/** Query fragments that depend on "what day is it".
 *
 *  These were SQL views using date('now'), which is UTC. At 8pm in New York
 *  the database already believes it is tomorrow, so the calendar showed
 *  Sunday's episode as "Tomorrow" and Up Next could surface an episode hours
 *  before it aired. Same root cause as the streak collapsing from 405 to 99.
 *
 *  'localtime' does not help: Turso's servers run UTC, so it returns the same
 *  wrong answer. The day has to come from the application, where Intl knows
 *  the timezone and handles DST. :today is a named parameter, so it can appear
 *  as often as needed and still be passed once.
 */

const AIRED = `(e.air_date IS NOT NULL AND e.air_date <= :today)`;

/** Furthest point reached in each show, as season*100000+number. */
const PROGRESS = `
  SELECT w.media_id, MAX(e.season * 100000 + e.number) AS watched_to
  FROM watch w JOIN episode e ON e.id = w.episode_id
  WHERE e.season > 0 GROUP BY w.media_id`;

/** The next aired, unwatched episode AFTER your furthest point — not the
 *  earliest unwatched, which for a back-catalogue show is decades old. */
export const UP_NEXT = `
WITH progress AS (${PROGRESS}),
candidate AS (
    SELECT e.media_id, MIN(e.season * 100000 + e.number) AS sort_key
    FROM episode e
    JOIN media m ON m.id = e.media_id
    LEFT JOIN progress p ON p.media_id = e.media_id
    WHERE m.type = 'show' AND m.status = 'watching' AND e.season > 0
      AND ${AIRED}
      AND (e.season * 100000 + e.number) > COALESCE(p.watched_to, -1)
      AND NOT EXISTS (SELECT 1 FROM watch w WHERE w.episode_id = e.id)
    GROUP BY e.media_id
),
last_seen AS (SELECT media_id, MAX(watched_at) AS last_watched_at FROM watch GROUP BY media_id)
SELECT m.id AS media_id, m.title AS show_title, m.poster_path, m.show_status,
       e.id AS episode_id, e.season, e.number, e.title AS episode_title,
       e.air_date, e.runtime, e.still_path, ls.last_watched_at,
       (p.watched_to IS NULL) AS never_started,
       (SELECT COUNT(*) FROM episode e2
         WHERE e2.media_id = m.id AND e2.season > 0
           AND e2.air_date IS NOT NULL AND e2.air_date <= :today
           AND (e2.season * 100000 + e2.number) > COALESCE(p.watched_to, -1)
           AND NOT EXISTS (SELECT 1 FROM watch w2 WHERE w2.episode_id = e2.id)) AS remaining
FROM candidate c
JOIN media m ON m.id = c.media_id
JOIN episode e ON e.media_id = c.media_id AND (e.season * 100000 + e.number) = c.sort_key
LEFT JOIN progress p ON p.media_id = m.id
LEFT JOIN last_seen ls ON ls.media_id = m.id`;

/** Upcoming episodes for shows you are watching. days_away is deliberately
 *  NOT computed in SQL — julianday against a UTC 'now' is what broke it. */
export const CALENDAR = `
SELECT m.id AS media_id, m.title AS show_title, m.poster_path,
       e.id AS episode_id, e.season, e.number, e.title AS episode_title,
       e.air_date, e.runtime, e.still_path,
       (e.season > 1 AND e.number = 1) AS is_premiere,
       (e.number = (SELECT MAX(e2.number) FROM episode e2
                     WHERE e2.media_id = m.id AND e2.season = e.season)) AS is_finale
FROM episode e
JOIN media m ON m.id = e.media_id
WHERE m.type = 'show' AND m.status = 'watching' AND e.season > 0
  AND e.air_date IS NOT NULL AND e.air_date > :today`;

/** status=watching, caught up, not over. returns_on distinguishes Airing
 *  (a date is known) from Between seasons (nothing announced). */
export const BETWEEN_SEASONS = `
WITH progress AS (${PROGRESS})
SELECT m.id AS media_id, m.title, m.poster_path, m.show_status,
       (SELECT MIN(air_date) FROM episode e2
         WHERE e2.media_id = m.id AND e2.season > 0 AND e2.air_date > :today) AS returns_on,
       (SELECT MAX(watched_at) FROM watch w WHERE w.media_id = m.id) AS last_watched_at
FROM media m
LEFT JOIN progress p ON p.media_id = m.id
WHERE m.type = 'show' AND m.status = 'watching'
  AND COALESCE(m.show_status, '') NOT IN ('Ended', 'Canceled')
  AND NOT EXISTS (
        SELECT 1 FROM episode e
        WHERE e.media_id = m.id AND e.season > 0 AND ${AIRED}
          AND (e.season * 100000 + e.number) > COALESCE(p.watched_to, -1)
          AND NOT EXISTS (SELECT 1 FROM watch w WHERE w.episode_id = e.id))`;

/** A finished show that has since aired episodes you have not seen. */
export const REVIVED = `
WITH progress AS (${PROGRESS})
SELECT m.id AS media_id, m.title, m.poster_path, m.show_status,
       COUNT(*) AS new_episodes, MIN(e.air_date) AS first_new_air_date,
       (SELECT MAX(watched_at) FROM watch w WHERE w.media_id = m.id) AS last_watched_at
FROM episode e
JOIN media m ON m.id = e.media_id
LEFT JOIN progress p ON p.media_id = m.id
WHERE m.type = 'show' AND m.status = 'watched' AND e.season > 0
  AND ${AIRED}
  AND (e.season * 100000 + e.number) > COALESCE(p.watched_to, -1)
  AND NOT EXISTS (SELECT 1 FROM watch w WHERE w.episode_id = e.id)
  AND (m.decision_dismissed_at IS NULL OR m.decision_dismissed_status IS NOT m.show_status)
GROUP BY m.id`;

/** Aired episodes sitting behind your furthest point — skipped, not pending. */
export const EPISODE_GAPS = `
WITH progress AS (${PROGRESS})
SELECT m.id AS media_id, m.title AS show_title, e.id AS episode_id,
       e.season, e.number, e.title AS episode_title, e.air_date
FROM episode e
JOIN media m ON m.id = e.media_id
JOIN progress p ON p.media_id = m.id
WHERE e.season > 0 AND ${AIRED}
  AND (e.season * 100000 + e.number) < p.watched_to
  AND NOT EXISTS (SELECT 1 FROM watch w WHERE w.episode_id = e.id)`;

/** Has this episode aired, in the viewer's timezone? */
export const AIRED_PREDICATE = AIRED;
