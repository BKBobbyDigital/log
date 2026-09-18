#!/bin/sh
# Nightly wrapper: cd into the project so relative paths (.env, data/) resolve,
# and append to a log so a failing run leaves evidence.
cd "$(dirname "$0")/.." || exit 1
exec /usr/bin/python3 scripts/sync.py >> data/sync.log 2>&1
