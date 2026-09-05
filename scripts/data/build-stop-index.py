#!/usr/bin/env python3
"""Build data/stops.json from validated GTFS archives in data/feeds/*.zip."""
import csv, json, sys, zipfile
from io import TextIOWrapper
from pathlib import Path

def build(root):
    records = []
    manifest_path = Path(root) / "manifest.json"
    manifest = json.loads(manifest_path.read_text(encoding="utf-8")) if manifest_path.exists() else {"feeds": []}
    metadata = {feed["id"]: feed for feed in manifest.get("feeds", [])}
    feeds = sorted(Path(root).glob("*.zip"), key=lambda feed: (metadata.get(feed.stem, {}).get("promoteAfter") is not None, feed.name))
    for feed in feeds:
        public_feed_id = metadata.get(feed.stem, {}).get("publicAgencyId", feed.stem)
        with zipfile.ZipFile(feed) as archive:
            agencies = list(csv.DictReader(TextIOWrapper(archive.open("agency.txt"), encoding="utf-8-sig")))
            agency_names = {row.get("agency_id", ""): row.get("agency_name", feed.stem) for row in agencies}
            agency = agencies[0].get("agency_name", feed.stem) if agencies else feed.stem
            for row in csv.DictReader(TextIOWrapper(archive.open("stops.txt"), encoding="utf-8-sig")):
                try: lat, lon = float(row["stop_lat"]), float(row["stop_lon"])
                except (KeyError, ValueError): continue
                if -80.2 < lon < -78.5 and 42.5 < lat < 45.0:
                    stop_id = row.get("stop_id", "")
                    if stop_id:
                        records.append({"id": f"{feed.stem}:{stop_id}", "name": row.get("stop_name", ""), "lat": lat, "lon": lon, "agency": agency_names.get(row.get("agency_id", ""), agency), "feedId": public_feed_id, "graphFeedId": feed.stem, "locationType": int(row.get("location_type") or 0), "parentStation": row.get("parent_station") or None, "code": row.get("stop_code") or None})
    payload = {"schemaVersion": 1, "source": "scripts/data/build-stop-index.py from official GTFS archives", "stops": records}
    Path("data/stops.json").write_text(json.dumps(payload, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
    return len(records)

if __name__ == "__main__":
    print(f"indexed {build(sys.argv[1] if len(sys.argv) > 1 else 'data/feeds')} stops")
