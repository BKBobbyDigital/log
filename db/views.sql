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
