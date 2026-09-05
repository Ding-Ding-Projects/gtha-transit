#!/usr/bin/env python3
"""Report active scheduled trip counts for selected dates in GTFS archives."""
import argparse, csv, datetime, io, json, zipfile
from pathlib import Path

parser = argparse.ArgumentParser()
parser.add_argument("root", type=Path)
parser.add_argument("dates", nargs="+")
args = parser.parse_args()
dates = [datetime.date.fromisoformat(value) for value in args.dates]
result = {}
for archive_path in sorted(args.root.glob("*.zip")):
    with zipfile.ZipFile(archive_path) as archive:
        names = set(archive.namelist())
        calendars = list(csv.DictReader(io.TextIOWrapper(archive.open("calendar.txt"), encoding="utf-8-sig"))) if "calendar.txt" in names else []
        exceptions = list(csv.DictReader(io.TextIOWrapper(archive.open("calendar_dates.txt"), encoding="utf-8-sig"))) if "calendar_dates.txt" in names else []
        trips = list(csv.DictReader(io.TextIOWrapper(archive.open("trips.txt"), encoding="utf-8-sig")))
        trips_by_service = {}
        for trip in trips: trips_by_service[trip["service_id"]] = trips_by_service.get(trip["service_id"], 0) + 1
        counts = {}
        for date in dates:
            compact = date.strftime("%Y%m%d")
            active = {row["service_id"] for row in calendars if row.get("start_date", "99999999") <= compact <= row.get("end_date", "00000000") and row.get(date.strftime("%A").lower()) == "1"}
            for row in exceptions:
                if row.get("date") != compact: continue
                if row.get("exception_type") == "1": active.add(row["service_id"])
                elif row.get("exception_type") == "2": active.discard(row["service_id"])
            counts[date.isoformat()] = sum(trips_by_service.get(service, 0) for service in active)
        result[archive_path.stem] = counts
print(json.dumps(result, indent=2))
