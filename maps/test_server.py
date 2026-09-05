#!/usr/bin/env python3
"""Focused HTTP tests for revision-bound MBTiles delivery."""
from __future__ import annotations

import hashlib
import json
import os
import sqlite3
import tempfile
import threading
import unittest
import urllib.error
import urllib.request
from contextlib import closing

import server


class MapRevisionHttpTest(unittest.TestCase):
    def setUp(self):
        self.temporary = tempfile.TemporaryDirectory()
        self.database = os.path.join(self.temporary.name, "regional.mbtiles")
        self._write_database(self.database, b"first tile bytes")
        server.MBTILES = self.database
        server.REVISION_CACHE = server.RevisionCache()
        self.httpd = server.ThreadingHTTPServer(("127.0.0.1", 0), server.Handler)
        self.thread = threading.Thread(target=self.httpd.serve_forever, daemon=True)
        self.thread.start()
        self.base = f"http://127.0.0.1:{self.httpd.server_port}"

    def tearDown(self):
        self.httpd.shutdown()
        self.httpd.server_close()
        self.thread.join(timeout=5)
        self.temporary.cleanup()

    @staticmethod
    def _write_database(path, tile_bytes):
        with closing(sqlite3.connect(path)) as db:
            db.execute("CREATE TABLE tiles(zoom_level INTEGER,tile_column INTEGER,tile_row INTEGER,tile_data BLOB)")
            db.execute("INSERT INTO tiles VALUES (8,1,253,?)", (tile_bytes,))
            db.commit()

    def _request(self, path):
        try:
            response = urllib.request.urlopen(self.base + path, timeout=5)
            return response.status, response.headers, response.read()
        except urllib.error.HTTPError as error:
            return error.code, error.headers, error.read()

    def test_map_info_hashes_actual_database_and_versioned_tile_preserves_bytes(self):
        status, headers, body = self._request("/map-info")
        self.assertEqual(status, 200)
        self.assertEqual(headers["Cache-Control"], "no-store")
        info = json.loads(body)
        with open(self.database, "rb") as source:
            self.assertEqual(info["revision"], hashlib.sha256(source.read()).hexdigest())
        self.assertEqual(info["minZoom"], 8)
        self.assertEqual(info["maxZoom"], 13)

        status, headers, body = self._request(f"/tiles/{info['revision']}/8/1/2.png")
        self.assertEqual(status, 200)
        self.assertEqual(body, b"first tile bytes")
        self.assertEqual(headers["Cache-Control"], "public, max-age=31536000, immutable")

    def test_atomic_replacement_gets_new_revision_and_rejects_old_revision(self):
        _, _, body = self._request("/map-info")
        old_revision = json.loads(body)["revision"]
        replacement = self.database + ".replacement"
        self._write_database(replacement, b"second tile bytes")
        os.replace(replacement, self.database)

        status, _, body = self._request("/map-info")
        self.assertEqual(status, 200)
        new_revision = json.loads(body)["revision"]
        self.assertNotEqual(new_revision, old_revision)

        status, headers, _ = self._request(f"/tiles/{old_revision}/8/1/2.png")
        self.assertEqual(status, 409)
        self.assertEqual(headers["Cache-Control"], "no-store")
        status, _, body = self._request(f"/tiles/{new_revision}/8/1/2.png")
        self.assertEqual(status, 200)
        self.assertEqual(body, b"second tile bytes")

    def test_unversioned_tile_is_revalidated_and_missing_map_info_is_unavailable(self):
        status, headers, body = self._request("/tiles/8/1/2.png")
        self.assertEqual(status, 200)
        self.assertEqual(body, b"first tile bytes")
        self.assertEqual(headers["Cache-Control"], "public, no-cache")

        os.unlink(self.database)
        status, headers, body = self._request("/map-info")
        self.assertEqual(status, 503)
        self.assertEqual(headers["Cache-Control"], "no-store")
        self.assertIn("cannot be read", json.loads(body)["error"])

    def test_concurrent_revision_reads_publish_one_consistent_cache_entry(self):
        barrier = threading.Barrier(9)
        results = []
        errors = []

        def read_revision():
            try:
                barrier.wait(timeout=5)
                results.append(server.REVISION_CACHE.current(self.database))
            except Exception as error:
                errors.append(error)

        workers = [threading.Thread(target=read_revision) for _ in range(8)]
        for worker in workers:
            worker.start()
        barrier.wait(timeout=5)
        for worker in workers:
            worker.join(timeout=5)

        self.assertFalse(errors)
        self.assertEqual(len(results), 8)
        self.assertEqual(len(set(results)), 1)
        self.assertEqual(server.REVISION_CACHE._entry, (results[0][1], results[0][0]))


class PlaceSearchHttpTest(unittest.TestCase):
    def setUp(self):
        self.temporary = tempfile.TemporaryDirectory()
        self.index = os.path.join(self.temporary.name, "places.sqlite3")
        self.previous_index = server.INDEX
        with closing(sqlite3.connect(self.index)) as db:
            db.execute(
                "CREATE VIRTUAL TABLE places USING fts5(name, search_text, kind UNINDEXED, "
                "lat UNINDEXED, lon UNINDEXED, source_id UNINDEXED, "
                "tokenize='unicode61 remove_diacritics 2')"
            )
            db.executemany(
                "INSERT INTO places VALUES (?,?,?,?,?,?)",
                [
                    ("Warden Avenue & Highway 7", "warden ave hwy 7 intersection", "intersection", None, None, "fixture/warden-hwy7"),
                    ("Ward Avenue", "ward ave", "road", None, None, "fixture/ward-avenue"),
                    ("Highway 7", "hwy 7", "road", None, None, "fixture/highway7"),
                    ("Yonge Street & Eglinton Avenue", "yonge st eglinton ave intersection", "intersection", None, None, "fixture/yonge-eglinton"),
                    ("Union Station", "union station", "station", None, None, "fixture/union-station"),
                    ("Union Avenue at Queen", "union ave queen", "road", None, None, "fixture/union-avenue"),
                    ("Saint Clair Avenue", "st clair ave", "road", None, None, "fixture/saint-clair"),
                    ("High Park", "high park", "place", None, None, "fixture/high-park"),
                    ("Route Place", "route place", "place", None, None, "fixture/route-place"),
                    ("Yonge Station", "yonge station", "station", None, None, "fixture/yonge-station"),
                    ("York Mills Station", "york mills station", "station", None, None, "fixture/york-mills"),
                ],
            )
            db.commit()
        server.INDEX = self.index
        self.httpd = server.ThreadingHTTPServer(("127.0.0.1", 0), server.Handler)
        self.thread = threading.Thread(target=self.httpd.serve_forever, daemon=True)
        self.thread.start()
        self.base = f"http://127.0.0.1:{self.httpd.server_port}"

    def tearDown(self):
        self.httpd.shutdown()
        self.httpd.server_close()
        self.thread.join(timeout=5)
        server.INDEX = self.previous_index
        self.temporary.cleanup()

    def search(self, query):
        with urllib.request.urlopen(f"{self.base}/search?{urllib.parse.urlencode({'q': query})}", timeout=5) as response:
            self.assertEqual(response.status, 200)
            return json.loads(response.read())["results"]

    def test_search_matches_partial_aliases_word_order_diacritics_and_ambiguity(self):
        for query in ("Warden Highway 7", "Warden Hwy 7", "ward high 7", "Highway 7 Warden"):
            self.assertEqual(self.search(query)[0]["id"], "fixture/warden-hwy7")
        self.assertEqual([item["id"] for item in self.search("ward high 7")], ["fixture/warden-hwy7"])
        for query in ("Yonge Eglinton", "Églinton / Yonge", "Eglinton Yonge"):
            self.assertEqual(self.search(query)[0]["id"], "fixture/yonge-eglinton")
        for query in ("Saint Clair", "St. Clair"):
            self.assertEqual(self.search(query)[0]["id"], "fixture/saint-clair")
        self.assertEqual(self.search("union")[0]["id"], "fixture/union-station")
        self.assertEqual(self.search("high park")[0]["id"], "fixture/high-park")
        self.assertEqual(self.search("route place")[0]["id"], "fixture/route-place")
        short_prefix_ids = {item["id"] for item in self.search("yo")}
        self.assertIn("fixture/yonge-station", short_prefix_ids)
        self.assertIn("fixture/york-mills", short_prefix_ids)


if __name__ == "__main__":
    unittest.main()
