#!/usr/bin/env python3
"""Focused fixture checks for bounded GTFS stop-route index generation."""

from __future__ import annotations

import csv
import hashlib
import importlib.util
import io
import json
import tempfile
import unittest
import zipfile
from pathlib import Path


MODULE_PATH = Path(__file__).with_name("build-stop-index.py")
SPEC = importlib.util.spec_from_file_location("build_stop_index", MODULE_PATH)
assert SPEC and SPEC.loader
INDEXER = importlib.util.module_from_spec(SPEC)
SPEC.loader.exec_module(INDEXER)


def csv_text(fields: list[str], rows: list[dict[str, object]]) -> str:
    output = io.StringIO(newline="")
    writer = csv.DictWriter(output, fieldnames=fields, lineterminator="\n")
    writer.writeheader()
    writer.writerows(rows)
    return output.getvalue()


def write_feed(root: Path, identifier: str, *, routes: list[dict[str, object]], trips: list[dict[str, object]], stop_times: list[dict[str, object]]) -> dict[str, object]:
    archive_path = root / f"{identifier}.zip"
    stops = [
        {"stop_id": "PARENT", "stop_name": "Parent Station", "stop_lat": "43.7000", "stop_lon": "-79.4000", "location_type": "1", "parent_station": "", "stop_code": "P"},
        {"stop_id": "A", "stop_name": "Platform A", "stop_lat": "43.7001", "stop_lon": "-79.4001", "location_type": "0", "parent_station": "PARENT", "stop_code": "A"},
        {"stop_id": "B", "stop_name": "Platform B", "stop_lat": "43.7002", "stop_lon": "-79.4002", "location_type": "0", "parent_station": "PARENT", "stop_code": "B"},
        {"stop_id": "C", "stop_name": "Route Two Only", "stop_lat": "43.7010", "stop_lon": "-79.4010", "location_type": "0", "parent_station": "", "stop_code": "C"},
        {"stop_id": "NEAR", "stop_name": "Nearby but unserved", "stop_lat": "43.7003", "stop_lon": "-79.4003", "location_type": "0", "parent_station": "", "stop_code": "N"},
    ]
    with zipfile.ZipFile(archive_path, "w", compression=zipfile.ZIP_DEFLATED) as archive:
        archive.writestr("agency.txt", csv_text(["agency_id", "agency_name"], [{"agency_id": "TTC", "agency_name": "Toronto Transit Commission"}]))
        archive.writestr("stops.txt", csv_text(["stop_id", "stop_name", "stop_lat", "stop_lon", "location_type", "parent_station", "stop_code"], stops))
        archive.writestr("routes.txt", csv_text(["route_id", "agency_id", "route_short_name", "route_long_name", "route_type", "route_color", "route_text_color"], routes))
        archive.writestr("trips.txt", csv_text(["route_id", "service_id", "trip_id", "direction_id"], trips))
        archive.writestr("stop_times.txt", csv_text(["trip_id", "arrival_time", "departure_time", "stop_id", "stop_sequence"], stop_times))
    return {"id": identifier, "name": "TTC", "file": archive_path.name, "bytes": archive_path.stat().st_size, "sha256": hashlib.sha256(archive_path.read_bytes()).hexdigest(), "publicAgencyId": "ttc", "source": f"https://publisher.example/{identifier}", "publisherDownloadUrl": f"https://publisher.example/{identifier}.zip", "serviceStart": "20260901", "serviceEnd": "20260930"}


class StopRouteIndexTests(unittest.TestCase):
    def make_valid_feeds(self, root: Path) -> Path:
        feeds = root / "feeds"
        feeds.mkdir()
        summer = write_feed(
            feeds,
            "ttc",
            routes=[
                {"route_id": "1", "agency_id": "TTC", "route_short_name": "1", "route_long_name": "One", "route_type": "3", "route_color": "ed1b2f", "route_text_color": "ffffff"},
                {"route_id": "2", "agency_id": "TTC", "route_short_name": "2", "route_long_name": "Two", "route_type": "3", "route_color": "", "route_text_color": ""},
            ],
            trips=[
                {"route_id": "1", "service_id": "WEEKDAY", "trip_id": "T1", "direction_id": "0"},
                {"route_id": "1", "service_id": "WEEKDAY", "trip_id": "T2", "direction_id": "1"},
                {"route_id": "2", "service_id": "WEEKDAY", "trip_id": "T3", "direction_id": "0"},
            ],
            stop_times=[
                {"trip_id": "T1", "arrival_time": "08:00:00", "departure_time": "08:00:00", "stop_id": "A", "stop_sequence": "20"},
                {"trip_id": "T1", "arrival_time": "07:55:00", "departure_time": "07:55:00", "stop_id": "B", "stop_sequence": "10"},
                {"trip_id": "T2", "arrival_time": "09:00:00", "departure_time": "09:00:00", "stop_id": "B", "stop_sequence": "10"},
                {"trip_id": "T2", "arrival_time": "09:05:00", "departure_time": "09:05:00", "stop_id": "A", "stop_sequence": "20"},
                {"trip_id": "T3", "arrival_time": "10:00:00", "departure_time": "10:00:00", "stop_id": "A", "stop_sequence": "10"},
                {"trip_id": "T3", "arrival_time": "10:05:00", "departure_time": "10:05:00", "stop_id": "C", "stop_sequence": "20"},
            ],
        )
        upcoming = write_feed(
            feeds,
            "ttc-next",
            routes=[{"route_id": "1", "agency_id": "TTC", "route_short_name": "1", "route_long_name": "One Next", "route_type": "3", "route_color": "", "route_text_color": ""}],
            trips=[{"route_id": "1", "service_id": "WEEKDAY", "trip_id": "NEXT", "direction_id": "0"}],
            stop_times=[
                {"trip_id": "NEXT", "arrival_time": "11:00:00", "departure_time": "11:00:00", "stop_id": "A", "stop_sequence": "10"},
                {"trip_id": "NEXT", "arrival_time": "11:05:00", "departure_time": "11:05:00", "stop_id": "B", "stop_sequence": "20"},
            ],
        )
        upcoming["promoteAfter"] = "2026-09-05"
        (feeds / "manifest.json").write_text(json.dumps({"schemaVersion": 1, "generatedAt": "2026-09-05T00:00:00Z", "feeds": [summer, upcoming]}, indent=2) + "\n", encoding="utf-8")
        return feeds

    def test_builds_source_backed_parent_unions_patterns_and_provenance(self) -> None:
        with tempfile.TemporaryDirectory() as temporary:
            root = Path(temporary)
            feeds = self.make_valid_feeds(root)
            output = root / "data"
            output.mkdir()
            (output / "feeds.json").write_text(json.dumps({"schemaVersion": 1, "agencies": [{"id": "ttc", "publicAgencyId": "ttc", "publisherLicense": "https://publisher.example/licence"}]}), encoding="utf-8")
            self.assertEqual(INDEXER.build(feeds, output), (10, 3, 4))
            routes = json.loads((output / "routes.json").read_text(encoding="utf-8"))
            patterns = json.loads((output / "route-patterns.json").read_text(encoding="utf-8"))
            self.assertEqual(routes["schemaVersion"], 2)
            self.assertEqual(routes["provenance"]["sourceArchiveCount"], 2)
            self.assertEqual(routes["provenance"]["routeCount"], 3)
            self.assertEqual(len(routes["provenance"]["manifestSha256"]), 64)
            self.assertEqual(routes["provenance"]["sourceArchives"][0]["license"], "https://publisher.example/licence")
            self.assertEqual(routes["provenance"]["sourceArchives"][0]["licenseState"], "verified")
            self.assertEqual(routes["provenance"]["sourceArchives"][0]["batchRetrievedAt"], "2026-09-05T00:00:00Z")
            self.assertEqual(routes["provenance"]["sourceArchives"][0]["individualRetrievalState"], "unavailable")
            self.assertEqual(routes["provenance"]["provenanceComplete"], True)
            summer_routes = {route["id"]: route for route in routes["routes"]}
            self.assertEqual(summer_routes["ttc:1"]["color"], "ED1B2F")
            self.assertEqual(summer_routes["ttc:1"]["textColor"], "FFFFFF")
            self.assertIsNone(summer_routes["ttc:2"]["color"])
            self.assertIsNone(summer_routes["ttc-next:1"]["textColor"])
            self.assertEqual(patterns["stopRoutes"]["ttc:PARENT"], ["ttc-next:1", "ttc:1", "ttc:2"])
            self.assertEqual(patterns["stopAliases"]["ttc:PARENT"], ["ttc-next:PARENT", "ttc:PARENT"])
            self.assertEqual(patterns["stopRoutes"]["ttc:A"], ["ttc-next:1", "ttc:1", "ttc:2"])
            self.assertNotIn("ttc:NEAR", patterns["stopRoutes"])
            directions = {pattern["directionId"]: pattern for pattern in patterns["routePatterns"]["ttc:1"]}
            self.assertEqual([stop["id"] for stop in directions["0"]["stops"]], ["ttc:B", "ttc:A"])
            self.assertEqual([stop["sequence"] for stop in directions["1"]["stops"]], [10, 20])
            self.assertEqual(directions["1"]["stops"][0]["lat"], 43.7002)

    def test_refuses_noncontiguous_trip_rows_instead_of_constructing_a_partial_pattern(self) -> None:
        with tempfile.TemporaryDirectory() as temporary:
            root = Path(temporary)
            feeds = root / "feeds"
            feeds.mkdir()
            feed = write_feed(
                feeds,
                "ttc",
                routes=[{"route_id": "1", "agency_id": "TTC", "route_short_name": "1", "route_long_name": "One", "route_type": "3", "route_color": "", "route_text_color": ""}],
                trips=[{"route_id": "1", "service_id": "WEEKDAY", "trip_id": "T1", "direction_id": "0"}, {"route_id": "1", "service_id": "WEEKDAY", "trip_id": "T2", "direction_id": "1"}],
                stop_times=[
                    {"trip_id": "T1", "arrival_time": "08:00:00", "departure_time": "08:00:00", "stop_id": "A", "stop_sequence": "10"},
                    {"trip_id": "T2", "arrival_time": "08:05:00", "departure_time": "08:05:00", "stop_id": "B", "stop_sequence": "10"},
                    {"trip_id": "T1", "arrival_time": "08:10:00", "departure_time": "08:10:00", "stop_id": "B", "stop_sequence": "20"},
                ],
            )
            (feeds / "manifest.json").write_text(json.dumps({"schemaVersion": 1, "generatedAt": "2026-09-05T00:00:00Z", "feeds": [feed]}), encoding="utf-8")
            with self.assertRaisesRegex(ValueError, "not grouped by trip_id"):
                INDEXER.build(feeds, root / "data")

    def test_rejects_a_manifest_without_a_valid_batch_receipt(self) -> None:
        with tempfile.TemporaryDirectory() as temporary:
            root = Path(temporary)
            feeds = self.make_valid_feeds(root)
            manifest_path = feeds / "manifest.json"
            manifest = json.loads(manifest_path.read_text(encoding="utf-8"))
            manifest.pop("generatedAt")
            manifest_path.write_text(json.dumps(manifest), encoding="utf-8")
            with self.assertRaisesRegex(ValueError, "generatedAt"):
                INDEXER.build(feeds, root / "data")

    def test_streams_a_multi_batch_trip_fixture_through_temporary_sqlite(self) -> None:
        with tempfile.TemporaryDirectory() as temporary:
            root = Path(temporary)
            feeds = root / "feeds"
            feeds.mkdir()
            trip_count = INDEXER.TRIP_INSERT_BATCH * 4 + 1
            feed = write_feed(
                feeds,
                "ttc",
                routes=[{"route_id": "1", "agency_id": "TTC", "route_short_name": "1", "route_long_name": "One", "route_type": "3", "route_color": "", "route_text_color": ""}],
                trips=[{"route_id": "1", "service_id": "WEEKDAY", "trip_id": f"T{index}", "direction_id": "0"} for index in range(trip_count)],
                stop_times=[{"trip_id": f"T{index}", "arrival_time": "08:00:00", "departure_time": "08:00:00", "stop_id": "A", "stop_sequence": "10"} for index in range(trip_count)],
            )
            (feeds / "manifest.json").write_text(json.dumps({"schemaVersion": 1, "generatedAt": "2026-09-05T00:00:00Z", "feeds": [feed]}), encoding="utf-8")
            output = root / "data"
            self.assertEqual(INDEXER.build(feeds, output), (5, 1, 1))
            routes = json.loads((output / "routes.json").read_text(encoding="utf-8"))
            self.assertEqual(routes["provenance"]["tripLookup"], {"storage": "temporary-sqlite", "insertBatchSize": 1024, "cacheKiB": 2048})
            self.assertEqual(routes["provenance"]["provenanceComplete"], False)
            self.assertEqual(routes["provenance"]["provenanceGaps"], [{"id": "ttc", "fields": ["license"]}])


if __name__ == "__main__":
    unittest.main()
