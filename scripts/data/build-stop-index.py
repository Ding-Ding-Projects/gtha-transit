#!/usr/bin/env python3
"""Build bounded local stop, route, and scheduled stop-route indexes from GTFS."""

from __future__ import annotations

import argparse
import csv
import hashlib
import json
import os
import sqlite3
import tempfile
import zipfile
from datetime import datetime, timezone
from io import TextIOWrapper
from pathlib import Path


REQUIRED_MEMBERS = {"agency.txt", "stops.txt", "routes.txt", "trips.txt", "stop_times.txt"}
MAX_STOPS_PER_FEED = 250_000
MAX_ROUTES_PER_FEED = 20_000
MAX_TRIPS_PER_FEED = 500_000
MAX_STOP_TIMES_PER_TRIP = 5_000
MAX_REPRESENTATIVE_PATTERNS_PER_DIRECTION = 4
TRIP_INSERT_BATCH = 1_024
TRIP_LOOKUP_CACHE_KIB = 2_048


def now_utc() -> str:
    return datetime.now(timezone.utc).isoformat().replace("+00:00", "Z")


def valid_hex(value: object) -> str | None:
    text = str(value or "").strip()
    return text.upper() if len(text) == 6 and all(character in "0123456789abcdefABCDEF" for character in text) else None


def required_text(row: dict[str, str], name: str, context: str) -> str:
    value = str(row.get(name) or "").strip()
    if not value:
        raise ValueError(f"{context} is missing {name}")
    return value


def optional_text(row: dict[str, str], name: str) -> str | None:
    value = str(row.get(name) or "").strip()
    return value or None


def parse_location_type(value: object) -> int:
    try:
        return int(str(value or "0"))
    except ValueError:
        return 0


def parse_coordinate(row: dict[str, str], name: str, context: str) -> float | None:
    value = optional_text(row, name)
    if value is None:
        return None
    try:
        coordinate = float(value)
    except ValueError as error:
        raise ValueError(f"{context} has an invalid {name}") from error
    if coordinate != coordinate or coordinate in (float("inf"), float("-inf")):
        raise ValueError(f"{context} has an invalid {name}")
    return coordinate


def parse_sequence(value: object, context: str) -> int:
    raw = str(value or "").strip()
    if not raw or not raw.lstrip("-").isdigit():
        raise ValueError(f"{context} has an invalid stop_sequence")
    return int(raw)


def csv_rows(archive: zipfile.ZipFile, member: str):
    with archive.open(member) as raw:
        with TextIOWrapper(raw, encoding="utf-8-sig", newline="") as text:
            yield from csv.DictReader(text)


def sha256_file(path: Path) -> str:
    digest = hashlib.sha256()
    with path.open("rb") as source:
        while chunk := source.read(1024 * 1024):
            digest.update(chunk)
    return digest.hexdigest()


def valid_timestamp(value: object, context: str) -> str:
    text = str(value or "").strip()
    if not text:
        raise ValueError(f"{context} is missing")
    try:
        parsed = datetime.fromisoformat(text.replace("Z", "+00:00"))
    except ValueError as error:
        raise ValueError(f"{context} is not an ISO-8601 timestamp") from error
    if parsed.tzinfo is None:
        raise ValueError(f"{context} must include a timezone offset")
    return text


def valid_gtfs_date(value: object, context: str) -> str:
    text = str(value or "").strip()
    if len(text) != 8 or not text.isdigit():
        raise ValueError(f"{context} is not a GTFS calendar date")
    try:
        datetime.strptime(text, "%Y%m%d")
    except ValueError as error:
        raise ValueError(f"{context} is not a GTFS calendar date") from error
    return text


def required_url(value: object, context: str) -> str:
    text = str(value or "").strip()
    if not text.startswith(("https://", "http://")):
        raise ValueError(f"{context} must be an HTTP(S) URL")
    return text


def required_manifest_text(entry: dict[str, object], field: str, identifier: str) -> str:
    value = str(entry.get(field) or "").strip()
    if not value:
        raise ValueError(f"feed manifest {identifier} is missing {field}")
    return value


def validate_manifest_entry(entry: dict[str, object], identifier: str) -> None:
    required_manifest_text(entry, "name", identifier)
    filename = required_manifest_text(entry, "file", identifier)
    if Path(filename).name != filename:
        raise ValueError(f"feed manifest {identifier} file must be a filename")
    required_manifest_text(entry, "publicAgencyId", identifier)
    required_url(entry.get("source"), f"feed manifest {identifier} source")
    required_url(entry.get("publisherDownloadUrl"), f"feed manifest {identifier} publisherDownloadUrl")
    start = valid_gtfs_date(entry.get("serviceStart"), f"feed manifest {identifier} serviceStart")
    end = valid_gtfs_date(entry.get("serviceEnd"), f"feed manifest {identifier} serviceEnd")
    if start > end:
        raise ValueError(f"feed manifest {identifier} serviceStart is after serviceEnd")
    try:
        if int(entry.get("bytes") or 0) <= 0:
            raise ValueError
    except (TypeError, ValueError) as error:
        raise ValueError(f"feed manifest {identifier} has an invalid byte count") from error


def license_records(*source_paths: Path) -> dict[str, dict[str, str | None]]:
    values: dict[str, set[str]] = {}
    for source_path in source_paths:
        if not source_path.is_file():
            continue
        try:
            source = json.loads(source_path.read_text(encoding="utf-8"))
        except json.JSONDecodeError as error:
            raise ValueError(f"invalid canonical licence source: {source_path}") from error
        entries = source.get("agencies") if isinstance(source.get("agencies"), list) else source.get("feeds")
        if not isinstance(entries, list):
            raise ValueError(f"canonical licence source has no agency or feed list: {source_path}")
        for agency in entries:
            if not isinstance(agency, dict):
                continue
            public_id = str(agency.get("publicAgencyId") or agency.get("id") or "").strip()
            if not public_id:
                continue
            license_value = next((str(agency.get(field) or "").strip() for field in ("publisherLicense", "publisherLicence", "license", "licence", "licenseUrl", "licenceUrl") if str(agency.get(field) or "").strip()), None)
            if license_value:
                values.setdefault(public_id, set()).add(license_value)
    return {public_id: {"value": next(iter(items)) if len(items) == 1 else None, "state": "verified" if len(items) == 1 else "conflicting"} for public_id, items in values.items()}


def read_manifest(root: Path) -> tuple[dict[str, dict[str, object]], dict[str, object], str]:
    manifest_path = root / "manifest.json"
    if not manifest_path.is_file():
        raise ValueError(f"missing validated feed manifest: {manifest_path}")
    raw = manifest_path.read_bytes()
    try:
        manifest = json.loads(raw)
    except json.JSONDecodeError as error:
        raise ValueError(f"invalid feed manifest: {manifest_path}") from error
    if manifest.get("schemaVersion") != 1:
        raise ValueError("feed manifest has an unsupported schemaVersion")
    valid_timestamp(manifest.get("generatedAt"), "feed manifest generatedAt")
    feeds = manifest.get("feeds")
    if not isinstance(feeds, list):
        raise ValueError("feed manifest has no feeds list")
    metadata: dict[str, dict[str, object]] = {}
    for entry in feeds:
        if not isinstance(entry, dict):
            raise ValueError("feed manifest contains an invalid feed record")
        identifier = str(entry.get("id") or "").strip()
        if not identifier or identifier in metadata:
            raise ValueError("feed manifest contains a missing or duplicate feed id")
        validate_manifest_entry(entry, identifier)
        metadata[identifier] = entry
    return metadata, manifest, hashlib.sha256(raw).hexdigest()


def validated_archives(root: Path, metadata: dict[str, dict[str, object]]) -> list[tuple[Path, dict[str, object], str]]:
    expected_paths: set[Path] = set()
    archives: list[tuple[Path, dict[str, object], str]] = []
    for identifier, entry in metadata.items():
        filename = str(entry.get("file") or f"{identifier}.zip")
        path = root / Path(filename).name
        if path.name != filename or not path.is_file():
            raise ValueError(f"validated archive is missing for {identifier}")
        expected_paths.add(path.resolve())
        expected_digest = str(entry.get("sha256") or "").lower()
        if len(expected_digest) != 64 or any(character not in "0123456789abcdef" for character in expected_digest):
            raise ValueError(f"validated archive has no SHA-256 receipt for {identifier}")
        actual_digest = sha256_file(path)
        if actual_digest != expected_digest:
            raise ValueError(f"validated archive SHA-256 mismatch for {identifier}")
        archives.append((path, entry, actual_digest))
    unexpected = sorted(path.name for path in root.glob("*.zip") if path.resolve() not in expected_paths)
    if unexpected:
        raise ValueError(f"feed directory contains archives absent from the validated manifest: {', '.join(unexpected)}")
    return sorted(archives, key=lambda item: str(item[1].get("id")))


def write_json_atomic(path: Path, payload: dict[str, object]) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    with tempfile.NamedTemporaryFile("w", encoding="utf-8", dir=path.parent, prefix=f".{path.name}.", suffix=".tmp", delete=False) as staged:
        json.dump(payload, staged, ensure_ascii=False, indent=2)
        staged.write("\n")
        staged_path = Path(staged.name)
    os.replace(staged_path, path)


def in_search_region(lat: float | None, lon: float | None) -> bool:
    return lat is not None and lon is not None and -80.2 < lon < -78.5 and 42.5 < lat < 45.0


def choose_pattern(bucket: list[dict[str, object]], candidate: dict[str, object]) -> None:
    fingerprint = str(candidate["_fingerprint"])
    if any(item["_fingerprint"] == fingerprint for item in bucket):
        return
    if len(bucket) < MAX_REPRESENTATIVE_PATTERNS_PER_DIRECTION:
        bucket.append(candidate)
        return
    largest_index = max(range(len(bucket)), key=lambda index: str(bucket[index]["_fingerprint"]))
    if fingerprint < str(bucket[largest_index]["_fingerprint"]):
        bucket[largest_index] = candidate


def build(feeds_root: Path, output_root: Path = Path("data"), registry_path: Path | None = None, graph_provenance_path: Path | None = None) -> tuple[int, int, int]:
    feeds_root = Path(feeds_root)
    output_root = Path(output_root)
    licenses = license_records(
        Path(registry_path) if registry_path else output_root / "feeds.json",
        Path(graph_provenance_path) if graph_provenance_path else output_root.parent / "backend/runtime/otp/graph-provenance.json",
    )
    metadata, manifest, manifest_sha256 = read_manifest(feeds_root)
    archives = validated_archives(feeds_root, metadata)

    records: list[dict[str, object]] = []
    routes: list[dict[str, object]] = []
    indexed_stop_ids: set[str] = set()
    stop_alias_groups: dict[tuple[str, str], set[str]] = {}
    stop_routes: dict[str, set[str]] = {}
    patterns_by_route_direction: dict[tuple[str, str | None], list[dict[str, object]]] = {}
    source_archives: list[dict[str, object]] = []

    for archive_path, feed_metadata, archive_digest in archives:
        feed_id = str(feed_metadata["id"])
        public_feed_id = str(feed_metadata.get("publicAgencyId") or feed_id)
        with zipfile.ZipFile(archive_path) as archive:
            members = {Path(name).name for name in archive.namelist()}
            missing = sorted(REQUIRED_MEMBERS - members)
            if missing:
                raise ValueError(f"{feed_id} is missing required GTFS members: {', '.join(missing)}")
            if archive.testzip():
                raise ValueError(f"{feed_id} has a corrupt GTFS member")

            agency_names: dict[str, str] = {}
            default_agency = str(feed_metadata.get("name") or feed_id)
            for agency_row in csv_rows(archive, "agency.txt"):
                agency_id = optional_text(agency_row, "agency_id") or ""
                agency_names[agency_id] = optional_text(agency_row, "agency_name") or default_agency
                if len(agency_names) == 1:
                    default_agency = agency_names[agency_id]

            stops: dict[str, dict[str, object]] = {}
            for stop_row in csv_rows(archive, "stops.txt"):
                stop_id = required_text(stop_row, "stop_id", f"{feed_id} stops.txt")
                if stop_id in stops:
                    raise ValueError(f"{feed_id} has duplicate stop_id {stop_id}")
                if len(stops) >= MAX_STOPS_PER_FEED:
                    raise ValueError(f"{feed_id} exceeds {MAX_STOPS_PER_FEED} stops")
                lat = parse_coordinate(stop_row, "stop_lat", f"{feed_id} stop {stop_id}")
                lon = parse_coordinate(stop_row, "stop_lon", f"{feed_id} stop {stop_id}")
                agency_id = optional_text(stop_row, "agency_id")
                parent_station = optional_text(stop_row, "parent_station")
                qualified_id = f"{feed_id}:{stop_id}"
                stop = {
                    "id": qualified_id,
                    "rawId": stop_id,
                    "name": optional_text(stop_row, "stop_name") or "",
                    "lat": lat,
                    "lon": lon,
                    "agency": agency_names.get(agency_id or "", default_agency),
                    "feedId": public_feed_id,
                    "graphFeedId": feed_id,
                    "locationType": parse_location_type(stop_row.get("location_type")),
                    "parentStation": parent_station,
                    "code": optional_text(stop_row, "stop_code"),
                }
                stops[stop_id] = stop
                if in_search_region(lat, lon):
                    records.append({key: value for key, value in stop.items() if key != "rawId"})
                    indexed_stop_ids.add(qualified_id)
                    stop_alias_groups.setdefault((public_feed_id, stop_id), set()).add(qualified_id)

            route_by_raw_id: dict[str, str] = {}
            for route_row in csv_rows(archive, "routes.txt"):
                route_id = required_text(route_row, "route_id", f"{feed_id} routes.txt")
                if route_id in route_by_raw_id:
                    raise ValueError(f"{feed_id} has duplicate route_id {route_id}")
                if len(route_by_raw_id) >= MAX_ROUTES_PER_FEED:
                    raise ValueError(f"{feed_id} exceeds {MAX_ROUTES_PER_FEED} routes")
                route_ref = f"{feed_id}:{route_id}"
                route_by_raw_id[route_id] = route_ref
                agency_id = optional_text(route_row, "agency_id")
                routes.append({
                    "id": route_ref,
                    "routeId": route_id,
                    "shortName": optional_text(route_row, "route_short_name"),
                    "longName": optional_text(route_row, "route_long_name"),
                    "agency": agency_names.get(agency_id or "", default_agency),
                    "agencyId": agency_id,
                    "feedId": public_feed_id,
                    "version": feed_id,
                    "color": valid_hex(route_row.get("route_color")),
                    "textColor": valid_hex(route_row.get("route_text_color")),
                    "routeType": optional_text(route_row, "route_type"),
                    "validity": {
                        "serviceStart": feed_metadata.get("serviceStart"),
                        "serviceEnd": feed_metadata.get("serviceEnd"),
                        "promoteAfter": feed_metadata.get("promoteAfter"),
                        "retireAfter": feed_metadata.get("retireAfter"),
                    },
                })

            with tempfile.TemporaryDirectory(prefix=f"gtha-stop-route-{feed_id}-") as temporary_root:
                trip_database = sqlite3.connect(Path(temporary_root) / "trips.sqlite")
                try:
                    trip_database.execute("PRAGMA journal_mode=OFF")
                    trip_database.execute("PRAGMA synchronous=OFF")
                    trip_database.execute("PRAGMA temp_store=FILE")
                    trip_database.execute(f"PRAGMA cache_size=-{TRIP_LOOKUP_CACHE_KIB}")
                    trip_database.execute("CREATE TABLE trips (trip_id TEXT PRIMARY KEY, route_ref TEXT NOT NULL, direction_id TEXT, completed INTEGER NOT NULL DEFAULT 0)")
                    trip_count = 0
                    pending_trips: list[tuple[str, str, str | None]] = []

                    def insert_pending_trips() -> None:
                        nonlocal pending_trips
                        if not pending_trips:
                            return
                        try:
                            trip_database.executemany("INSERT INTO trips (trip_id, route_ref, direction_id) VALUES (?, ?, ?)", pending_trips)
                        except sqlite3.IntegrityError as error:
                            raise ValueError(f"{feed_id} has duplicate trip_id") from error
                        pending_trips = []

                    for trip_row in csv_rows(archive, "trips.txt"):
                        trip_id = required_text(trip_row, "trip_id", f"{feed_id} trips.txt")
                        route_id = required_text(trip_row, "route_id", f"{feed_id} trip {trip_id}")
                        if trip_count >= MAX_TRIPS_PER_FEED:
                            raise ValueError(f"{feed_id} exceeds {MAX_TRIPS_PER_FEED} trips")
                        route_ref = route_by_raw_id.get(route_id)
                        if route_ref is None:
                            raise ValueError(f"{feed_id} trip {trip_id} references unknown route {route_id}")
                        pending_trips.append((trip_id, route_ref, optional_text(trip_row, "direction_id")))
                        trip_count += 1
                        if len(pending_trips) >= TRIP_INSERT_BATCH:
                            insert_pending_trips()
                    insert_pending_trips()
                    trip_database.commit()

                    current_trip_id: str | None = None
                    current_rows: list[tuple[int, str]] = []

                    def flush_current_trip() -> None:
                        nonlocal current_trip_id, current_rows
                        if current_trip_id is None:
                            return
                        trip = trip_database.execute("SELECT route_ref, direction_id, completed FROM trips WHERE trip_id = ?", (current_trip_id,)).fetchone()
                        if trip is None:
                            raise ValueError(f"{feed_id} stop_times references unknown trip {current_trip_id}")
                        route_ref, direction_id, completed = trip
                        if completed:
                            raise ValueError(f"{feed_id} stop_times is not grouped by trip_id; refusing to invent a partial pattern")
                        if not current_rows:
                            raise ValueError(f"{feed_id} trip {current_trip_id} has no stop_times")
                        ordered_rows = sorted(current_rows)
                        if len({sequence for sequence, _ in ordered_rows}) != len(ordered_rows):
                            raise ValueError(f"{feed_id} trip {current_trip_id} has duplicate stop_sequence values")
                        pattern_stops: list[dict[str, object]] = []
                        digest = hashlib.sha256()
                        digest.update(route_ref.encode("utf-8"))
                        digest.update(b"\x1f")
                        digest.update(str(direction_id or "").encode("utf-8"))
                        for sequence, stop_id in ordered_rows:
                            stop = stops.get(stop_id)
                            if stop is None:
                                raise ValueError(f"{feed_id} trip {current_trip_id} references unknown stop {stop_id}")
                            qualified_id = str(stop["id"])
                            digest.update(f"\x1e{sequence}\x1f{stop_id}".encode("utf-8"))
                            pattern_stops.append({
                                "id": qualified_id,
                                "sequence": sequence,
                                "name": stop["name"],
                                "lat": stop["lat"],
                                "lon": stop["lon"],
                            })
                            if qualified_id in indexed_stop_ids:
                                stop_routes.setdefault(qualified_id, set()).add(route_ref)
                            parent_raw_id = stop["parentStation"]
                            if parent_raw_id:
                                parent_qualified_id = f"{feed_id}:{parent_raw_id}"
                                if parent_qualified_id in indexed_stop_ids:
                                    stop_routes.setdefault(parent_qualified_id, set()).add(route_ref)
                        fingerprint = digest.hexdigest()
                        bucket = patterns_by_route_direction.setdefault((route_ref, direction_id), [])
                        choose_pattern(bucket, {"_fingerprint": fingerprint, "id": f"{route_ref}:{fingerprint[:16]}", "directionId": direction_id, "stops": pattern_stops})
                        changed = trip_database.execute("UPDATE trips SET completed = 1 WHERE trip_id = ? AND completed = 0", (current_trip_id,)).rowcount
                        if changed != 1:
                            raise ValueError(f"{feed_id} stop_times is not grouped by trip_id; refusing to invent a partial pattern")
                        current_trip_id = None
                        current_rows = []

                    for stop_time_row in csv_rows(archive, "stop_times.txt"):
                        trip_id = required_text(stop_time_row, "trip_id", f"{feed_id} stop_times.txt")
                        if current_trip_id is None:
                            current_trip_id = trip_id
                        elif trip_id != current_trip_id:
                            flush_current_trip()
                            current_trip_id = trip_id
                        if len(current_rows) >= MAX_STOP_TIMES_PER_TRIP:
                            raise ValueError(f"{feed_id} trip {trip_id} exceeds {MAX_STOP_TIMES_PER_TRIP} stop_times")
                        current_rows.append((parse_sequence(stop_time_row.get("stop_sequence"), f"{feed_id} trip {trip_id}"), required_text(stop_time_row, "stop_id", f"{feed_id} trip {trip_id}")))
                    flush_current_trip()
                    missing_trips = int(trip_database.execute("SELECT COUNT(*) FROM trips WHERE completed = 0").fetchone()[0])
                    if missing_trips:
                        raise ValueError(f"{feed_id} has {missing_trips} trips without stop_times")
                finally:
                    trip_database.close()

        license_record = licenses.get(public_feed_id, {"value": None, "state": "unavailable"})
        individual_retrieved_at = feed_metadata.get("retrievedAt")
        if individual_retrieved_at is not None:
            individual_retrieved_at = valid_timestamp(individual_retrieved_at, f"feed manifest {feed_id} retrievedAt")
        source_archives.append({
            "id": feed_id,
            "publicAgencyId": public_feed_id,
            "file": archive_path.name,
            "sha256": archive_digest,
            "bytes": archive_path.stat().st_size,
            "source": feed_metadata.get("source"),
            "publisherDownloadUrl": feed_metadata.get("publisherDownloadUrl"),
            "batchRetrievedAt": manifest.get("generatedAt"),
            "individualRetrievedAt": individual_retrieved_at,
            "individualRetrievalState": "exact" if individual_retrieved_at else "unavailable",
            "license": license_record["value"],
            "licenseState": license_record["state"],
            "archiveRetrievedAt": feed_metadata.get("archiveRetrievedAt"),
            "serviceStart": feed_metadata.get("serviceStart"),
            "serviceEnd": feed_metadata.get("serviceEnd"),
            "promoteAfter": feed_metadata.get("promoteAfter"),
            "retireAfter": feed_metadata.get("retireAfter"),
        })

    route_patterns: dict[str, list[dict[str, object]]] = {}
    for (route_ref, _), bucket in patterns_by_route_direction.items():
        selected = sorted(bucket, key=lambda item: str(item["_fingerprint"]))
        route_patterns.setdefault(route_ref, []).extend({key: value for key, value in pattern.items() if key != "_fingerprint"} for pattern in selected)
    for patterns in route_patterns.values():
        patterns.sort(key=lambda pattern: (str(pattern["directionId"] or ""), str(pattern["id"])))

    generated_at = now_utc()
    records.sort(key=lambda stop: str(stop["id"]))
    routes.sort(key=lambda route: (str(route["feedId"]), str(route["routeId"]), str(route["version"])))
    expanded_stop_routes: dict[str, set[str]] = {}
    for aliases in stop_alias_groups.values():
        route_refs = set().union(*(stop_routes.get(alias, set()) for alias in aliases))
        if route_refs:
            for alias in aliases:
                expanded_stop_routes[alias] = route_refs
    stop_route_payload = {stop_id: sorted(route_refs) for stop_id, route_refs in sorted(expanded_stop_routes.items())}
    pattern_count = sum(len(patterns) for patterns in route_patterns.values())
    provenance_gaps = [{"id": archive["id"], "fields": ["license"]} for archive in source_archives if archive["licenseState"] != "verified"]
    provenance = {
        "manifestSha256": manifest_sha256,
        "manifestGeneratedAt": manifest.get("generatedAt"),
        "sourceArchiveCount": len(source_archives),
        "indexedStopCount": len(records),
        "routeCount": len(routes),
        "servedStopCount": len(stop_route_payload),
        "patternCount": pattern_count,
        "maxRepresentativePatternsPerDirection": MAX_REPRESENTATIVE_PATTERNS_PER_DIRECTION,
        "tripLookup": {"storage": "temporary-sqlite", "insertBatchSize": TRIP_INSERT_BATCH, "cacheKiB": TRIP_LOOKUP_CACHE_KIB},
        "sourceArchives": source_archives,
        "provenanceComplete": not provenance_gaps,
        "provenanceGaps": provenance_gaps,
    }
    write_json_atomic(output_root / "stops.json", {
        "schemaVersion": 2,
        "generatedAt": generated_at,
        "source": "scripts/data/build-stop-index.py from checksum-validated official GTFS archives",
        "provenance": {key: provenance[key] for key in ("manifestSha256", "manifestGeneratedAt", "sourceArchiveCount", "indexedStopCount", "sourceArchives")},
        "stops": records,
    })
    write_json_atomic(output_root / "routes.json", {
        "schemaVersion": 2,
        "generatedAt": generated_at,
        "source": "scripts/data/build-stop-index.py from checksum-validated official GTFS archives",
        "provenance": provenance,
        "routes": routes,
    })
    write_json_atomic(output_root / "route-patterns.json", {
        "schemaVersion": 1,
        "generatedAt": generated_at,
        "source": "scripts/data/build-stop-index.py from checksum-validated official GTFS archives",
        "provenance": {
            key: provenance[key]
            for key in (
                "manifestSha256",
                "manifestGeneratedAt",
                "sourceArchiveCount",
                "routeCount",
                "servedStopCount",
                "patternCount",
                "maxRepresentativePatternsPerDirection",
                "sourceArchives",
            )
        },
        "stopRoutes": stop_route_payload,
        "routePatterns": route_patterns,
    })
    return len(records), len(routes), pattern_count


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("feeds", nargs="?", type=Path, default=Path("data/feeds"))
    parser.add_argument("--output", type=Path, default=Path("data"))
    parser.add_argument("--registry", type=Path)
    parser.add_argument("--graph-provenance", type=Path)
    args = parser.parse_args()
    stops, routes, patterns = build(args.feeds, args.output, args.registry, args.graph_provenance)
    print(f"indexed {stops} stops, {routes} routes, and {patterns} representative patterns")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
