#!/bin/sh
set -eu
SCRIPT_DIR=$(CDPATH= cd -- "$(dirname -- "$0")" && pwd -P)
ROOT=${1:-$(dirname "$SCRIPT_DIR")}
ROOT=$(CDPATH= cd -- "$ROOT" && pwd -P)
GRAPH="$ROOT/backend/runtime/otp/graph.obj"
PROVENANCE="$ROOT/backend/runtime/otp/graph-provenance.json"
if [ -e "$GRAPH" ] || [ -e "$PROVENANCE" ]; then
  test -s "$GRAPH"
  test -s "$PROVENANCE"
  python3 "$ROOT/scripts/data/verify-active-graph-feeds.py" --graph-provenance "$PROVENANCE" --manifest "$ROOT/data/feeds/manifest.json" --feeds-dir "$ROOT/data/feeds"
fi
BEFORE=$(sha256sum "$ROOT"/data/feeds/*.zip 2>/dev/null || true)
python3 "$ROOT/scripts/data/fetch-feeds.py" --registry "$ROOT/data/feeds.json" --output "$ROOT/data/feeds"
AFTER=$(sha256sum "$ROOT"/data/feeds/*.zip)
(cd "$ROOT" && python3 scripts/build-stop-index.py data/feeds)
if [ "$BEFORE" = "$AFTER" ] && [ -s "$ROOT/backend/runtime/otp/graph.obj" ]; then
  echo "feeds unchanged; active graph retained"
  exit 0
fi
sh "$ROOT/backend/build-graph.sh" "$ROOT"
(cd "$ROOT/backend" && docker compose up -d --build)
