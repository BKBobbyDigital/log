-- Personal watch tracker — schema
-- Two sources of truth:
--   1. media.status  — set only by the user, never by the app
--   2. watch         — append-only log of every play
-- Every screen is a query over those two.

PRAGMA foreign_keys = ON;

CREATE TABLE media (
    id              INTEGER PRIMARY KEY,
    type            TEXT    NOT NULL CHECK (type IN ('movie','show')),

    -- external ids; tmdb is what we enrich against, trakt is the import key
    tmdb_id         INTEGER,
    imdb_id         TEXT,
    tvdb_id         INTEGER,
    trakt_id        INTEGER NOT NULL,
    slug            TEXT,

    title           TEXT    NOT NULL,
    year            INTEGER,

    -- user-controlled. the app never writes this.
    status          TEXT    CHECK (status IN ('watchlist','watching','watched','stopped')),
    status_set_at   TEXT,

    -- filled by TMDB enrichment
    poster_path     TEXT,
    backdrop_path   TEXT,
    overview        TEXT,
    runtime         INTEGER,          -- minutes; movie runtime or show avg
    tmdb_rating     REAL,
    show_status     TEXT,             -- 'Returning Series' | 'Ended' | 'Canceled' | ...
    aired_episodes  INTEGER,
    enriched_at     TEXT,

    UNIQUE (type, trakt_id)
);

CREATE INDEX idx_media_status  ON media (status, type);
CREATE INDEX idx_media_tmdb    ON media (type, tmdb_id);

CREATE TABLE episode (
    id              INTEGER PRIMARY KEY,
    media_id        INTEGER NOT NULL REFERENCES media(id) ON DELETE CASCADE,
    season          INTEGER NOT NULL,
    number          INTEGER NOT NULL,
    title           TEXT,

    tmdb_id         INTEGER,
    imdb_id         TEXT,
    tvdb_id         INTEGER,
    trakt_id        INTEGER,

    -- the calendar and the "has it aired?" test depend on this
    air_date        TEXT,
    runtime         INTEGER,
    still_path      TEXT,

    UNIQUE (media_id, season, number)
);

CREATE INDEX idx_episode_media ON episode (media_id, season, number);
CREATE INDEX idx_episode_air   ON episode (air_date);

-- append-only. never updated, never deleted by the app.
CREATE TABLE watch (
    id                INTEGER PRIMARY KEY,
    media_id          INTEGER NOT NULL REFERENCES media(id) ON DELETE CASCADE,
    episode_id        INTEGER REFERENCES episode(id) ON DELETE CASCADE,  -- NULL for movies
    watched_at        TEXT    NOT NULL,

    -- true for the Dec-2023 bulk import and pre-2023 estimated dates.
    -- stats exclude these by default so the timeline isn't a skyscraper.
    is_backfill       INTEGER NOT NULL DEFAULT 0,

    -- calendar day in the user's timezone; day-boundary stats use this,
    -- never UTC (a 10pm watch in NY is 02:00 UTC the next day)
    local_day         TEXT,

    trakt_history_id  INTEGER UNIQUE
);

CREATE INDEX idx_watch_media   ON watch (media_id, watched_at);
CREATE INDEX idx_watch_episode ON watch (episode_id);
CREATE INDEX idx_watch_date    ON watch (watched_at);
CREATE INDEX idx_watch_local   ON watch (local_day);

CREATE TABLE rating (
    id          INTEGER PRIMARY KEY,
    media_id    INTEGER NOT NULL REFERENCES media(id) ON DELETE CASCADE,
    season      INTEGER,                                    -- season rating
    episode_id  INTEGER REFERENCES episode(id) ON DELETE CASCADE,
    rating      INTEGER NOT NULL CHECK (rating BETWEEN 1 AND 10),
    rated_at    TEXT,
    UNIQUE (media_id, season, episode_id)
);

-- things the import could not fully resolve; surfaced once, then cleared
CREATE TABLE import_issue (
    id        INTEGER PRIMARY KEY,
    kind      TEXT NOT NULL,
    detail    TEXT NOT NULL,
    media_id  INTEGER REFERENCES media(id) ON DELETE CASCADE
);
