#!/bin/sh
set -eu
SCRIPT_DIR=$(CDPATH= cd -- "$(dirname -- "$0")" && pwd -P)
ROOT=${1:-$(dirname "$SCRIPT_DIR")}
ROOT=$(CDPATH= cd -- "$ROOT" && pwd -P)
RUNTIME="$ROOT/backend/runtime"
mkdir -p "$RUNTIME/staging"
BUILD=$(mktemp -d "$RUNTIME/staging/graph.XXXXXXXX")
case "$BUILD" in "$RUNTIME"/staging/*) ;; *) echo "unsafe graph staging path" >&2; exit 1;; esac
cleanup() { echo "Graph staging retained for diagnosis: $BUILD" >&2; }
trap cleanup EXIT INT TERM
cp "$ROOT/data/otp/otp-shaded-2.9.0.jar" "$BUILD/otp.jar"
cp "$ROOT/data/ontario-latest.osm.pbf" "$BUILD/ontario-latest.osm.pbf"
cp "$ROOT/backend/otp/otp-config.json" "$ROOT/backend/otp/router-config.json" "$ROOT/backend/otp/build-config.json" "$BUILD/"
for FEED in "$ROOT"/data/feeds/*.zip; do
  NAME=$(basename "$FEED" .zip)
  cp "$FEED" "$BUILD/$NAME.gtfs.zip"
done
docker run --rm --cpus=4 --memory=13g -v "$BUILD:/var/otp" eclipse-temurin:25-jre java -Xms2g -Xmx12g -XX:+UseG1GC -jar /var/otp/otp.jar --build --save /var/otp
test -s "$BUILD/graph.obj"
python3 "$ROOT/scripts/data/write-graph-provenance.py" --manifest "$ROOT/data/feeds/manifest.json" --graph "$BUILD/graph.obj" --feeds-dir "$ROOT/data/feeds" --output "$BUILD/graph-provenance.json"
sh "$ROOT/backend/verify-graph.sh" "$BUILD"
NEXT="$RUNTIME/otp.next.$$"
PREVIOUS="$RUNTIME/otp.previous"
mv "$BUILD" "$NEXT"
BUILD="$RUNTIME/staging/consumed.$$"
if [ -d "$PREVIOUS" ]; then rm -rf -- "$PREVIOUS"; fi
if [ -d "$RUNTIME/otp" ]; then mv "$RUNTIME/otp" "$PREVIOUS"; fi
mv "$NEXT" "$RUNTIME/otp"
trap - EXIT INT TERM
