#!/usr/bin/env python3
"""Focused CLI tests for candidate MBTiles verification."""
from __future__ import annotations

import io
import json
import os
import sqlite3
import subprocess
import sys
import tempfile
import unittest
from contextlib import closing

from PIL import Image


class VerifyMbtilesCliTest(unittest.TestCase):
    def setUp(self):
        self.temporary = tempfile.TemporaryDirectory()
        self.addCleanup(self.temporary.cleanup)
        self.baseline = os.path.join(self.temporary.name, "baseline.mbtiles")
        self.candidate = os.path.join(self.temporary.name, "candidate.mbtiles")
        self.script = os.path.join(os.path.dirname(__file__), "verify_mbtiles.py")
        self._write_database(self.baseline, missing_zoom=None, corrupt_zoom=None, color=(240, 240, 240))

    def test_same_coverage_valid_candidate_is_accepted(self):
        self._write_database(self.candidate, missing_zoom=None, corrupt_zoom=None, color=(230, 238, 246))
        result, report = self._run()
        self.assertEqual(result.returncode, 0, result.stdout + result.stderr)
        self.assertTrue(report["ok"])
        self.assertEqual(report["candidate"]["tileCountByZoom"], {str(zoom): 1 for zoom in range(8, 14)})
        self.assertNotEqual(report["candidate"]["sha256"], report["baseline"]["sha256"])
        self.assertGreater(report["candidate"]["fileBytes"], 0)

    def test_missing_or_corrupt_candidate_is_rejected(self):
        for missing_zoom, corrupt_zoom, expected in (
            (11, None, "coverage differs"),
            (None, 12, "not a decodable PNG"),
        ):
            with self.subTest(missing_zoom=missing_zoom, corrupt_zoom=corrupt_zoom):
                if os.path.exists(self.candidate):
                    os.unlink(self.candidate)
                self._write_database(
                    self.candidate,
                    missing_zoom=missing_zoom,
                    corrupt_zoom=corrupt_zoom,
                    color=(230, 238, 246),
                )
                result, report = self._run()
                self.assertNotEqual(result.returncode, 0)
                self.assertFalse(report["ok"])
                self.assertIn(expected, report["error"])

    def _run(self):
        result = subprocess.run(
            [sys.executable, self.script, self.candidate, self.baseline],
            check=False,
            capture_output=True,
            text=True,
            timeout=15,
        )
        return result, json.loads(result.stdout)

    @staticmethod
    def _write_database(path, missing_zoom, corrupt_zoom, color):
        with closing(sqlite3.connect(path)) as database:
            database.executescript("""
                CREATE TABLE metadata(name TEXT,value TEXT);
                CREATE TABLE tiles(zoom_level INTEGER,tile_column INTEGER,tile_row INTEGER,tile_data BLOB,
                  PRIMARY KEY(zoom_level,tile_column,tile_row));
            """)
            database.executemany("INSERT INTO metadata VALUES (?,?)", [
                ("format", "png"), ("minzoom", "8"), ("maxzoom", "13"),
            ])
            for zoom in range(8, 14):
                if zoom == missing_zoom:
                    continue
                body = b"not a png" if zoom == corrupt_zoom else VerifyMbtilesCliTest._png(color)
                database.execute("INSERT INTO tiles VALUES (?,?,?,?)", (zoom, 1, (1 << zoom) - 3, body))
            database.commit()

    @staticmethod
    def _png(color):
        output = io.BytesIO()
        Image.new("RGB", (256, 256), color).save(output, format="PNG")
        return output.getvalue()


if __name__ == "__main__":
    unittest.main()
