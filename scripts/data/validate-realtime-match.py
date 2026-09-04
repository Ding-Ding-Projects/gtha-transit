#!/usr/bin/env python3
"""Verify that a GTFS-RT TripUpdates feed joins to its scheduled GTFS feed."""
import argparse, csv, io, json, urllib.request, zipfile
from google.transit import gtfs_realtime_pb2

parser = argparse.ArgumentParser()
parser.add_argument("--static", required=True)
parser.add_argument("--realtime", required=True)
args = parser.parse_args()
with zipfile.ZipFile(args.static) as archive:
    scheduled = {row["trip_id"] for row in csv.DictReader(io.TextIOWrapper(archive.open("trips.txt"), encoding="utf-8-sig"))}
request = urllib.request.Request(args.realtime, headers={"User-Agent": "GTHATransitRealtimeValidator/1.0"})
message = gtfs_realtime_pb2.FeedMessage()
with urllib.request.urlopen(request, timeout=30) as response:
    message.ParseFromString(response.read(64 * 1024 * 1024))
updates = {entity.trip_update.trip.trip_id for entity in message.entity if entity.HasField("trip_update") and entity.trip_update.trip.trip_id}
matched = updates & scheduled
result = {"scheduledTrips": len(scheduled), "updatedTrips": len(updates), "matchedTrips": len(matched), "matchRatio": len(matched) / len(updates) if updates else 0}
print(json.dumps(result))
if not updates or not matched:
    raise SystemExit(1)
