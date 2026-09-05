#!/usr/bin/env python3
"""Bind public provenance to the exact feed snapshot consumed by a graph build."""
import argparse, csv, datetime, io, json, zipfile
from pathlib import Path

parser = argparse.ArgumentParser()
parser.add_argument("--manifest", type=Path, required=True)
parser.add_argument("--graph", type=Path, required=True)
parser.add_argument("--feeds-dir", type=Path, required=True)
parser.add_argument("--output", type=Path, required=True)
args = parser.parse_args()
manifest = json.loads(args.manifest.read_text(encoding="utf-8"))
graph_time_value = datetime.datetime.fromtimestamp(args.graph.stat().st_mtime, datetime.timezone.utc)
graph_time = graph_time_value.isoformat().replace("+00:00", "Z")
start_date = graph_time_value.date()
dates = [start_date + datetime.timedelta(days=offset) for offset in range(15)]

def active_trip_counts(archive_path):
    with zipfile.ZipFile(archive_path) as archive:
        names = set(archive.namelist())
        calendars = list(csv.DictReader(io.TextIOWrapper(archive.open("calendar.txt"), encoding="utf-8-sig"))) if "calendar.txt" in names else []
        exceptions = list(csv.DictReader(io.TextIOWrapper(archive.open("calendar_dates.txt"), encoding="utf-8-sig"))) if "calendar_dates.txt" in names else []
        trips = list(csv.DictReader(io.TextIOWrapper(archive.open("trips.txt"), encoding="utf-8-sig")))
    by_service = {}
    for trip in trips: by_service[trip["service_id"]] = by_service.get(trip["service_id"], 0) + 1
    result = {}
    for date in dates:
        compact = date.strftime("%Y%m%d")
        active = {row["service_id"] for row in calendars if row.get("start_date", "99999999") <= compact <= row.get("end_date", "00000000") and row.get(date.strftime("%A").lower()) == "1"}
        for row in exceptions:
            if row.get("date") == compact:
                if row.get("exception_type") == "1": active.add(row["service_id"])
                elif row.get("exception_type") == "2": active.discard(row["service_id"])
        result[date.isoformat()] = sum(by_service.get(service, 0) for service in active)
    return result

feeds = []
for feed in manifest.get("feeds", []):
    record = {key: feed.get(key) for key in ("id", "sha256", "serviceStart", "serviceEnd")}
    record["activeTripsByDate"] = active_trip_counts(args.feeds_dir / feed["file"])
    feeds.append(record)
payload = {"source": "OpenTripPlanner", "updatedAt": manifest.get("generatedAt"), "graphBuiltAt": graph_time, "timezone": "America/Toronto", "feeds": feeds}
args.output.write_text(json.dumps(payload, indent=2) + "\n", encoding="utf-8")
