#!/bin/sh
# Fix /data ownership when the bind-mount host dir was created by a different
# UID (common when /data is freshly created by Docker on first bind mount).
# Then drop to the unprivileged `node` user for the main process.
set -e

# Only chown if /data exists (it always does — we created it in the Dockerfile).
# -R to catch WAL/SHM sidecars and DB files written by a prior root-owned run.
chown -R node:node /data 2>/dev/null || true

# Exec CMD as node user. gosu is preferred over su (no PAM, no password).
exec gosu node "$@"
