-- Stats. Two rules:
--   1. organic watches only (is_backfill = 0) — the Dec-2023 bulk import
--      would otherwise be a skyscraper next to everything else
--   2. days are LOCAL days (watch.local_day), never UTC. A 10pm watch in
--      New York is 02:00 UTC the next day, which silently breaks streaks.

DROP VIEW IF EXISTS watch_days;
DROP VIEW IF EXISTS streaks;

CREATE VIEW watch_days AS
SELECT DISTINCT local_day AS day FROM watch WHERE is_backfill = 0;

-- gaps-and-islands: runs of consecutive days collapse into one row
CREATE VIEW streaks AS
WITH numbered AS (
    SELECT day, julianday(day) - ROW_NUMBER() OVER (ORDER BY day) AS grp
    FROM watch_days
)
SELECT COUNT(*) AS length, MIN(day) AS started, MAX(day) AS ended
FROM numbered GROUP BY grp;
