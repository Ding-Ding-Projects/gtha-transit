#!/usr/bin/env python3
"""Build data/stops.json from validated GTFS archives in data/feeds/*.zip."""
import csv, json, sys, zipfile
from pathlib import Path

def build(root):
    records = []
    for feed in sorted(Path(root).glob("*.zip")):
        with zipfile.ZipFile(feed) as archive:
            agency = next(csv.DictReader(__import__("io").TextIOWrapper(archive.open("agency.txt"), encoding="utf-8-sig")), {}).get("agency_name", feed.stem)
            for row in csv.DictReader(__import__("io").TextIOWrapper(archive.open("stops.txt"), encoding="utf-8-sig")):
                try: lat, lon = float(row["stop_lat"]), float(row["stop_lon"])
                except (KeyError, ValueError): continue
                if -80.2 < lon < -78.5 and 42.5 < lat < 45.0:
                    records.append({"id": row.get("stop_id", ""), "name": row.get("stop_name", ""), "lat": lat, "lon": lon, "agency": agency})
    payload = {"schemaVersion": 1, "source": "scripts/data/build-stop-index.py from official GTFS archives", "stops": records}
    Path("data/stops.json").write_text(json.dumps(payload, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
    return len(records)

if __name__ == "__main__":
    print(f"indexed {build(sys.argv[1] if len(sys.argv) > 1 else 'data/feeds')} stops")
