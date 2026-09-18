#!/usr/bin/env python3
"""One connection helper for every script, so they all talk to the same
database the live app uses.

Presents the small slice of the sqlite3 API these scripts actually need
(execute / executemany / commit / close, results as tuples, lastrowid) backed
by either Turso or a local file. That keeps the tested logic in sync.py and
auto_finish.py untouched -- only the connection changes.

Turso when TURSO_DATABASE_URL is set, otherwise data/tracker.db.
Pass --local to force the file even when Turso is configured.
"""
import os, sqlite3, sys

HERE = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))


def _env():
    path = os.path.join(HERE, '.env')
    out = {}
    if os.path.exists(path):
        for line in open(path):
            if '=' in line and not line.startswith('#'):
                k, v = line.strip().split('=', 1)
                out[k] = v
    # real environment wins, so CI can supply secrets without a file
    out.update({k: v for k, v in os.environ.items() if k in (
        'TURSO_DATABASE_URL', 'TURSO_AUTH_TOKEN', 'TMDB_API_KEY', 'LOCAL_TZ')})
    return out


class _Result:
    """Just enough of a sqlite3 cursor: iterable, fetchone, fetchall, lastrowid."""
    __slots__ = ('_rows', 'lastrowid', 'rowcount')

    def __init__(self, rows, lastrowid=None, rowcount=-1):
        self._rows = rows
        self.lastrowid = lastrowid
        self.rowcount = rowcount

    def __iter__(self):
        return iter(self._rows)

    def fetchall(self):
        return list(self._rows)

    def fetchone(self):
        return self._rows[0] if self._rows else None


class TursoConn:
    """Remote connection. Note: every statement autocommits, so commit() is a
    no-op -- there is no open transaction to flush. executemany() uses batch(),
    which IS atomic."""

    def __init__(self, url, token):
        import libsql_client
        # the client speaks https; libsql:// is the same endpoint
        if url.startswith('libsql://'):
            url = 'https://' + url[len('libsql://'):]
        self._c = libsql_client.create_client_sync(url=url, auth_token=token)

    def execute(self, sql, params=()):
        if sql.strip().upper().startswith('PRAGMA'):
            return _Result([])            # meaningless against a remote database
        rs = self._c.execute(sql, list(params))
        return _Result([tuple(r) for r in rs.rows],
                       getattr(rs, 'last_insert_rowid', None),
                       getattr(rs, 'rows_affected', -1))

    def executemany(self, sql, seq):
        stmts = [(sql, list(p)) for p in seq]
        for i in range(0, len(stmts), 500):
            self._c.batch(stmts[i:i + 500])

    def commit(self):
        pass

    def close(self):
        self._c.close()


def connect(force_local=False):
    env = _env()
    url = env.get('TURSO_DATABASE_URL')
    if url and not force_local and '--local' not in sys.argv:
        print(f"db: turso ({url.split('//')[-1].split('.')[0]})")
        return TursoConn(url, env.get('TURSO_AUTH_TOKEN', ''))
    path = os.path.join(HERE, 'data', 'tracker.db')
    print(f"db: local file ({path})")
    con = sqlite3.connect(path)
    con.execute('PRAGMA journal_mode=WAL')
    con.execute('PRAGMA foreign_keys=ON')
    return con


def tmdb_key():
    k = _env().get('TMDB_API_KEY')
    if not k:
        raise SystemExit('TMDB_API_KEY not set (checked .env and the environment)')
    return k
