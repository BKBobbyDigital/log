-- Derived views. Nothing here ever writes a status — these are pure queries
-- over (media.status, watch). Specials (season 0) are excluded from queues.

DROP VIEW IF EXISTS up_next;
DROP VIEW IF EXISTS calendar_upcoming;
DROP VIEW IF EXISTS needs_decision;
DROP VIEW IF EXISTS watchlist_rail;

-- ── UP NEXT ───────────────────────────────────────────────────────────────
-- status=watching AND an episode has aired that isn't logged.
-- A show you're caught up on simply falls out; it returns by itself the day
-- a new episode airs. No status change, ever.
CREATE VIEW up_next AS
WITH progress AS (
    -- furthest point reached in each show, as season*100000+number
    SELECT w.media_id, MAX(e.season * 100000 + e.number) AS watched_to
    FROM watch w
    JOIN episode e ON e.id = w.episode_id
    WHERE e.season > 0
    GROUP BY w.media_id
),
candidate AS (
    -- the next aired episode AFTER that point. Not the earliest unwatched:
    -- for a show with a deep back catalog (SNL, The Simpsons) the earliest
    -- unwatched is decades old and never what you mean by "up next".
    SELECT e.media_id, MIN(e.season * 100000 + e.number) AS sort_key
    FROM episode e
    JOIN media m ON m.id = e.media_id
    LEFT JOIN progress p ON p.media_id = e.media_id
    WHERE m.type = 'show'
      AND m.status = 'watching'
      AND e.season > 0
      AND e.air_date IS NOT NULL
      AND e.air_date <= date('now')
      AND (e.season * 100000 + e.number) > COALESCE(p.watched_to, -1)
      AND NOT EXISTS (SELECT 1 FROM watch w WHERE w.episode_id = e.id)
    GROUP BY e.media_id
),
last_seen AS (
    SELECT media_id, MAX(watched_at) AS last_watched_at
    FROM watch GROUP BY media_id
)
SELECT m.id            AS media_id,
       m.title         AS show_title,
       m.poster_path,
       m.show_status,
       e.id            AS episode_id,
       e.season, e.number,
       e.title         AS episode_title,
       e.air_date, e.runtime, e.still_path,
       ls.last_watched_at,
       (p.watched_to IS NULL) AS never_started,
       (SELECT COUNT(*) FROM episode e2
         WHERE e2.media_id = m.id AND e2.season > 0
           AND e2.air_date IS NOT NULL AND e2.air_date <= date('now')
           AND (e2.season * 100000 + e2.number) > COALESCE(p.watched_to, -1)
           AND NOT EXISTS (SELECT 1 FROM watch w2 WHERE w2.episode_id = e2.id)
       ) AS remaining
FROM candidate c
JOIN media   m ON m.id = c.media_id
JOIN episode e ON e.media_id = c.media_id
                AND (e.season * 100000 + e.number) = c.sort_key
LEFT JOIN progress  p  ON p.media_id = m.id
LEFT JOIN last_seen ls ON ls.media_id = m.id;

-- ── CALENDAR ──────────────────────────────────────────────────────────────
-- Upcoming episodes for shows you're watching. Not yet aired.
CREATE VIEW calendar_upcoming AS
SELECT m.id AS media_id, m.title AS show_title, m.poster_path,
       e.id AS episode_id, e.season, e.number, e.title AS episode_title,
       e.air_date, e.runtime, e.still_path,
       CAST(julianday(e.air_date) - julianday(date('now')) AS INTEGER) AS days_away,
       (e.season > 1 AND e.number = 1) AS is_premiere,
       (e.number = (SELECT MAX(e2.number) FROM episode e2
                     WHERE e2.media_id = m.id AND e2.season = e.season)) AS is_finale
FROM episode e
JOIN media m ON m.id = e.media_id
WHERE m.type = 'show'
  AND m.status = 'watching'
  AND e.season > 0
  AND e.air_date IS NOT NULL
  AND e.air_date > date('now');

-- ── REVIVED ───────────────────────────────────────────────────────────────
-- The counterpart to auto-finish: a show marked `watched` that has since
-- aired episodes you haven't seen. Without this, auto-finishing a show would
-- bury it forever if it ever came back — the same blind spot in reverse.
-- Still a prompt, never an automatic status change.
DROP VIEW IF EXISTS needs_decision;
DROP VIEW IF EXISTS revived;
CREATE VIEW revived AS
WITH progress AS (
    SELECT w.media_id, MAX(e.season * 100000 + e.number) AS watched_to
    FROM watch w JOIN episode e ON e.id = w.episode_id
    WHERE e.season > 0 GROUP BY w.media_id
)
SELECT m.id AS media_id, m.title, m.poster_path, m.show_status,
       COUNT(*)          AS new_episodes,
       MIN(e.air_date)   AS first_new_air_date,
       (SELECT MAX(watched_at) FROM watch w WHERE w.media_id = m.id) AS last_watched_at
FROM episode e
JOIN media m ON m.id = e.media_id
LEFT JOIN progress p ON p.media_id = m.id
WHERE m.type = 'show'
  AND m.status = 'watched'
  AND e.season > 0
  AND e.air_date IS NOT NULL AND e.air_date <= date('now')
  AND (e.season * 100000 + e.number) > COALESCE(p.watched_to, -1)
  AND NOT EXISTS (SELECT 1 FROM watch w WHERE w.episode_id = e.id)
  AND (m.decision_dismissed_at IS NULL
       OR m.decision_dismissed_status IS NOT m.show_status)
GROUP BY m.id;

-- ── BETWEEN SEASONS ───────────────────────────────────────────────────────
-- status=watching, caught up, and not over. One label whether or not a return
-- date is known — the date is just extra detail when TMDB has it.
DROP VIEW IF EXISTS between_seasons;
CREATE VIEW between_seasons AS
WITH progress AS (
    SELECT w.media_id, MAX(e.season * 100000 + e.number) AS watched_to
    FROM watch w JOIN episode e ON e.id = w.episode_id
    WHERE e.season > 0 GROUP BY w.media_id
)
SELECT m.id AS media_id, m.title, m.poster_path, m.show_status,
       (SELECT MIN(air_date) FROM episode e2
         WHERE e2.media_id = m.id AND e2.season > 0
           AND e2.air_date > date('now')) AS returns_on,
       (SELECT MAX(watched_at) FROM watch w WHERE w.media_id = m.id) AS last_watched_at
FROM media m
LEFT JOIN progress p ON p.media_id = m.id
WHERE m.type = 'show'
  AND m.status = 'watching'
  AND COALESCE(m.show_status, '') NOT IN ('Ended', 'Canceled')
  AND NOT EXISTS (
        SELECT 1 FROM episode e
        WHERE e.media_id = m.id AND e.season > 0
          AND e.air_date IS NOT NULL AND e.air_date <= date('now')
          AND (e.season * 100000 + e.number) > COALESCE(p.watched_to, -1)
          AND NOT EXISTS (SELECT 1 FROM watch w WHERE w.episode_id = e.id));

-- ── WATCHLIST ─────────────────────────────────────────────────────────────
CREATE VIEW watchlist_rail AS
SELECT id AS media_id, type, title, year, poster_path, runtime,
       tmdb_rating, show_status, status_set_at
FROM media
WHERE status = 'watchlist';

-- ── EPISODE GAPS ──────────────────────────────────────────────────────────
-- Aired episodes sitting BEHIND your furthest point — skipped, not pending.
-- Deliberately not a home-screen rail: for a back-catalog show like SNL this
-- is 266 rows and pure noise. Belongs on the show detail page.
DROP VIEW IF EXISTS episode_gaps;
CREATE VIEW episode_gaps AS
WITH progress AS (
    SELECT w.media_id, MAX(e.season * 100000 + e.number) AS watched_to
    FROM watch w JOIN episode e ON e.id = w.episode_id
    WHERE e.season > 0 GROUP BY w.media_id
)
SELECT m.id AS media_id, m.title AS show_title,
       e.id AS episode_id, e.season, e.number, e.title AS episode_title, e.air_date
FROM episode e
JOIN media    m ON m.id = e.media_id
JOIN progress p ON p.media_id = m.id
WHERE e.season > 0
  AND e.air_date IS NOT NULL AND e.air_date <= date('now')
  AND (e.season * 100000 + e.number) < p.watched_to
  AND NOT EXISTS (SELECT 1 FROM watch w WHERE w.episode_id = e.id);
