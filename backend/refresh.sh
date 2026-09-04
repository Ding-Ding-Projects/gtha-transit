#!/bin/sh
set -eu
ROOT=${1:-/home/docker/gtha-transit-backend}
python3 "$ROOT/scripts/fetch-feeds.py" --registry "$ROOT/data/feeds.json" --output "$ROOT/data/feeds"
(cd "$ROOT" && python3 scripts/build-stop-index.py data/feeds)
"$ROOT/backend/build-graph.sh" "$ROOT"
(cd "$ROOT/backend" && docker compose up -d --build)
