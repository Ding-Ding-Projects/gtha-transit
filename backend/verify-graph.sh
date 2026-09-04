#!/bin/sh
set -eu
GRAPH_DIR=$(CDPATH= cd -- "$1" && pwd -P)
NAME="gtha-otp-verify-$$"
cleanup() { docker rm -f "$NAME" >/dev/null 2>&1 || true; }
trap cleanup EXIT INT TERM
docker run -d --name "$NAME" --cpus=2 --memory=9g -p 127.0.0.1::8080 -v "$GRAPH_DIR:/var/otp:ro" eclipse-temurin:25-jre java -Xms2g -Xmx8g -jar /var/otp/otp.jar --load --serve /var/otp >/dev/null
PORT=$(docker port "$NAME" 8080/tcp | sed -n 's/.*://p')
i=0
until curl -fsS "http://127.0.0.1:$PORT/otp/gtfs/v1" -H 'content-type: application/json' --data '{"query":"{ stop(id:\"go:UN\") { name } }"}' | grep -q 'Union Station GO'; do
  i=$((i+1)); [ "$i" -lt 60 ] || { docker logs "$NAME" >&2; exit 1; }; sleep 5
done
curl -fsS "http://127.0.0.1:$PORT/otp/gtfs/v1" -H 'content-type: application/json' --data '{"query":"query($o:PlanLabeledLocationInput!,$d:PlanLabeledLocationInput!,$t:PlanDateTimeInput!){planConnection(origin:$o,destination:$d,dateTime:$t,first:1,modes:{transitOnly:true}){edges{node{duration}}}}","variables":{"o":{"location":{"coordinate":{"latitude":43.6453,"longitude":-79.3806}}},"d":{"location":{"coordinate":{"latitude":43.686,"longitude":-79.7597}}},"t":{"earliestDeparture":"2026-09-05T09:00:00-04:00"}}}' | grep -q 'duration'
