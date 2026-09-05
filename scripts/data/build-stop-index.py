#!/usr/bin/env python3
"""Build local stop and route indexes from validated GTFS archives."""
import csv, json, sys, zipfile
from datetime import datetime, timezone
from io import TextIOWrapper
from pathlib import Path

def valid_hex(value):
    text = str(value or "").strip()
    return text.upper() if len(text) == 6 and all(character in "0123456789abcdefABCDEF" for character in text) else None

def build(root):
    records, routes = [], []
    manifest_path = Path(root) / "manifest.json"
    manifest = json.loads(manifest_path.read_text(encoding="utf-8")) if manifest_path.exists() else {"feeds": []}
    metadata = {feed["id"]: feed for feed in manifest.get("feeds", [])}
    feeds = sorted(Path(root).glob("*.zip"), key=lambda feed: (metadata.get(feed.stem, {}).get("promoteAfter") is not None, feed.name))
    for feed in feeds:
        public_feed_id = metadata.get(feed.stem, {}).get("publicAgencyId", feed.stem)
        feed_metadata = metadata.get(feed.stem, {})
        with zipfile.ZipFile(feed) as archive:
            agencies = list(csv.DictReader(TextIOWrapper(archive.open("agency.txt"), encoding="utf-8-sig")))
            agency_names = {row.get("agency_id", ""): row.get("agency_name", feed.stem) for row in agencies}
            agency = agencies[0].get("agency_name", feed.stem) if agencies else feed.stem
            for row in csv.DictReader(TextIOWrapper(archive.open("routes.txt"), encoding="utf-8-sig")):
                route_id = row.get("route_id", "").strip()
                if not route_id:
                    continue
                routes.append({"id": f"{feed.stem}:{route_id}", "routeId": route_id, "shortName": row.get("route_short_name") or None, "longName": row.get("route_long_name") or None, "agency": agency_names.get(row.get("agency_id", ""), agency), "agencyId": row.get("agency_id") or None, "feedId": public_feed_id, "version": feed.stem, "color": valid_hex(row.get("route_color")), "textColor": valid_hex(row.get("route_text_color")), "routeType": row.get("route_type") or None, "validity": {"serviceStart": feed_metadata.get("serviceStart"), "serviceEnd": feed_metadata.get("serviceEnd"), "promoteAfter": feed_metadata.get("promoteAfter"), "retireAfter": feed_metadata.get("retireAfter")}})
            for row in csv.DictReader(TextIOWrapper(archive.open("stops.txt"), encoding="utf-8-sig")):
                try: lat, lon = float(row["stop_lat"]), float(row["stop_lon"])
                except (KeyError, ValueError): continue
                if -80.2 < lon < -78.5 and 42.5 < lat < 45.0:
                    stop_id = row.get("stop_id", "")
                    if stop_id:
                        records.append({"id": f"{feed.stem}:{stop_id}", "name": row.get("stop_name", ""), "lat": lat, "lon": lon, "agency": agency_names.get(row.get("agency_id", ""), agency), "feedId": public_feed_id, "graphFeedId": feed.stem, "locationType": int(row.get("location_type") or 0), "parentStation": row.get("parent_station") or None, "code": row.get("stop_code") or None})
    payload = {"schemaVersion": 1, "source": "scripts/data/build-stop-index.py from official GTFS archives", "stops": records}
    Path("data/stops.json").write_text(json.dumps(payload, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
    route_payload = {"schemaVersion": 1, "generatedAt": datetime.now(timezone.utc).isoformat().replace("+00:00", "Z"), "source": "scripts/data/build-stop-index.py from validated official GTFS archives", "routes": routes}
    Path("data/routes.json").write_text(json.dumps(route_payload, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
    return len(records), len(routes)

if __name__ == "__main__":
    stops, routes = build(sys.argv[1] if len(sys.argv) > 1 else 'data/feeds')
    print(f"indexed {stops} stops and {routes} routes")
