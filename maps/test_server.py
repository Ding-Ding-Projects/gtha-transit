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


if __name__ == "__main__":
    unittest.main()
