#!/usr/bin/env bash
# Menagerie guide — regenerate from source.
#   serve the app (prod = the single index.html) → capture screenshots → build HTML.
# Idempotent: reuses a running server on PORT, else starts one and stops it after.
# Usage: guide/regenerate.sh [--only slug1,slug2]
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
PORT="${MENAGERIE_GUIDE_PORT:-8799}"
BASE="http://127.0.0.1:${PORT}/index.html"
ONLY=""
[ "${1:-}" = "--only" ] && ONLY="--only $2"

started=""
if ! curl -sf -o /dev/null "http://127.0.0.1:${PORT}/index.html"; then
  echo "starting server on :${PORT}…"
  ( cd "$ROOT" && python3 -m http.server "$PORT" --bind 127.0.0.1 >/dev/null 2>&1 ) &
  started=$!
  for _ in $(seq 1 30); do curl -sf -o /dev/null "$BASE" && break || sleep 0.2; done
fi

echo "capturing…"
python3 "$ROOT/guide/capture.py" --base "$BASE" $ONLY

echo "building…"
python3 "$ROOT/guide/build_index.py"

[ -n "$started" ] && kill "$started" 2>/dev/null || true
echo "done → guide/index.html"
