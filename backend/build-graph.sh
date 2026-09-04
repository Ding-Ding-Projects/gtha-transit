#!/bin/sh
set -eu
ROOT=${1:-/home/docker/gtha-transit-backend}
RUNTIME="$ROOT/backend/runtime"
BUILD="$ROOT/build"
rm -rf "$BUILD"
mkdir -p "$BUILD"
cp "$ROOT/data/otp/otp-shaded-2.9.0.jar" "$BUILD/otp.jar"
cp "$ROOT/data/ontario-latest.osm.pbf" "$BUILD/ontario-latest.osm.pbf"
cp "$ROOT/backend/otp/otp-config.json" "$ROOT/backend/otp/router-config.json" "$ROOT/backend/otp/build-config.json" "$BUILD/"
for FEED in "$ROOT"/data/feeds/*.zip; do
  NAME=$(basename "$FEED" .zip)
  cp "$FEED" "$BUILD/$NAME.gtfs.zip"
done
docker run --rm --cpus=4 --memory=13g -v "$BUILD:/var/otp" eclipse-temurin:25-jre java -Xms2g -Xmx12g -XX:+UseG1GC -jar /var/otp/otp.jar --build --save /var/otp
test -s "$BUILD/graph.obj"
rm -rf "$RUNTIME/otp.next"
mv "$BUILD" "$RUNTIME/otp.next"
rm -rf "$RUNTIME/otp.previous"
if [ -d "$RUNTIME/otp" ]; then mv "$RUNTIME/otp" "$RUNTIME/otp.previous"; fi
mv "$RUNTIME/otp.next" "$RUNTIME/otp"
