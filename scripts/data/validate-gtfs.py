#!/usr/bin/env python3
"""Validate downloaded GTFS archives without external packages."""
import csv, io, json, sys, zipfile
from pathlib import Path

REQUIRED = ("agency.txt", "stops.txt", "routes.txt", "trips.txt", "stop_times.txt")

def validate(feed):
    path = Path(feed)
    if not path.is_file(): raise ValueError(f"missing feed: {path}")
    with zipfile.ZipFile(path) as archive:
        names = set(archive.namelist())
        missing = [name for name in REQUIRED if name not in names]
        if missing: raise ValueError(f"missing required GTFS files: {', '.join(missing)}")
        counts = {}
        for name in REQUIRED:
            with archive.open(name) as stream:
                rows = list(csv.DictReader(io.TextIOWrapper(stream, encoding="utf-8-sig", newline="")))
            if not rows: raise ValueError(f"empty GTFS file: {name}")
            counts[name] = len(rows)
        return {"feed": str(path), "counts": counts, "valid": True}

if __name__ == "__main__":
    try: print(json.dumps(validate(sys.argv[1]), indent=2))
    except (IndexError, OSError, zipfile.BadZipFile, ValueError) as error:
        print(json.dumps({"valid": False, "error": str(error)})); raise SystemExit(1)
