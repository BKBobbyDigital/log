-- Views that do NOT depend on "what day is it".
--
-- up_next, calendar_upcoming, between_seasons, revived and episode_gaps used
-- to live here. They compared air_date against date('now'), which is UTC: at
-- 8pm in New York the database already believes it is tomorrow, so the
-- calendar showed Sunday's episode as "Tomorrow" and Up Next could surface an
-- episode before it aired. 'localtime' does not help — Turso runs UTC.
--
-- Their definitions now live in web/lib/sql.ts as parameterised fragments
-- taking a named :today from the application, where the timezone is known and
-- DST is handled. Deliberately ONE definition, not two that drift apart.

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
