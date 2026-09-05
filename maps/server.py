#!/usr/bin/env python3
"""Small offline tile and place-search service for a regional transit map."""
from __future__ import annotations

import json
import hashlib
import math
import os
import re
import sqlite3
import threading
import urllib.parse
from contextlib import closing
from http import HTTPStatus
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer

ROOT = os.path.dirname(os.path.abspath(__file__))
MBTILES = os.environ.get("MBTILES", os.path.join(ROOT, "data", "ontario.mbtiles"))
INDEX = os.environ.get("PLACE_INDEX", os.path.join(ROOT, "data", "places.sqlite3"))
HOST = os.environ.get("MAP_HOST", "0.0.0.0")
PORT = int(os.environ.get("MAP_PORT", "8789"))
MIN_ZOOM = 8
MAX_ZOOM = 13
HASH_CHUNK_SIZE = 1024 * 1024
HASH_LOCK_TIMEOUT_SECONDS = 5

ALIASES = {
    "avenue": "ave", "av": "ave", "road": "rd", "street": "st",
    "boulevard": "blvd", "drive": "dr", "lane": "ln", "court": "ct",
    "parkway": "pkwy", "highway": "hwy", "route": "hwy",
}

def _search_terms(query):
    words = re.sub(r"[^0-9a-z]+", " ", query.casefold()).split()
    return [ALIASES.get(word, word) for word in words if word not in {"and", "at", "the"}]

def _json(handler, status, body):
    data = json.dumps(body, ensure_ascii=False).encode("utf-8")
    handler.send_response(status)
    handler.send_header("Content-Type", "application/json; charset=utf-8")
    handler.send_header("Content-Length", str(len(data)))
    handler.send_header("Cache-Control", "no-store")
    handler.end_headers()
    handler.wfile.write(data)

def _tile_row(z, y):
    # MBTiles stores rows from the south (TMS), while Leaflet requests XYZ.
    return (1 << z) - 1 - y

class RevisionUnavailable(Exception):
    pass

class RevisionCache:
    def __init__(self):
        self._lock = threading.Lock()
        self._entry = None

    @staticmethod
    def identity(stat_result):
        return (stat_result.st_dev, stat_result.st_ino, stat_result.st_size, stat_result.st_mtime_ns)

    def current(self, path):
        try:
            identity = self.identity(os.stat(path))
        except OSError as error:
            raise RevisionUnavailable(f"regional MBTiles cannot be read: {error.strerror or error}") from error
        entry = self._entry
        if entry is not None and identity == entry[0]:
            return entry[1], identity
        if not self._lock.acquire(timeout=HASH_LOCK_TIMEOUT_SECONDS):
            raise RevisionUnavailable("regional MBTiles revision is busy")
        try:
            try:
                with open(path, "rb") as source:
                    before = self.identity(os.fstat(source.fileno()))
                    entry = self._entry
                    if entry is not None and before == entry[0]:
                        return entry[1], before
                    digest = hashlib.sha256()
                    while chunk := source.read(HASH_CHUNK_SIZE):
                        digest.update(chunk)
                    after = self.identity(os.fstat(source.fileno()))
                current = self.identity(os.stat(path))
            except OSError as error:
                raise RevisionUnavailable(f"regional MBTiles cannot be read: {error.strerror or error}") from error
            if before != after or after != current:
                raise RevisionUnavailable("regional MBTiles changed while its revision was calculated")
            revision = digest.hexdigest()
            self._entry = (current, revision)
            return revision, current
        finally:
            self._lock.release()

REVISION_CACHE = RevisionCache()

class Handler(BaseHTTPRequestHandler):
    server_version = "GTHAOfflineMaps/1.0"
    def log_message(self, fmt, *args):
        return

    def do_GET(self):
        parsed = urllib.parse.urlparse(self.path)
        if parsed.path == "/health":
            _json(self, HTTPStatus.OK, {"ok": True, "tiles": os.path.exists(MBTILES), "index": os.path.exists(INDEX)})
            return
        if parsed.path == "/map-info":
            self.map_info()
            return
        if parsed.path == "/search":
            self.search(urllib.parse.parse_qs(parsed.query).get("q", [""])[0])
            return
        match = re.fullmatch(r"/tiles/(\d+)/(\d+)/(\d+)\.png", parsed.path)
        if match:
            self.tile(*(int(x) for x in match.groups()), revision=None)
            return
        match = re.fullmatch(r"/tiles/([0-9a-f]{64})/(\d+)/(\d+)/(\d+)\.png", parsed.path)
        if match:
            revision, *coordinates = match.groups()
            self.tile(*(int(x) for x in coordinates), revision=revision)
            return
        _json(self, HTTPStatus.NOT_FOUND, {"error": "route not found"})

    def search(self, query):
        query = " ".join(query.strip().split())
        if not query or len(query) > 120:
            _json(self, HTTPStatus.BAD_REQUEST, {"error": "q must contain 1 to 120 characters"})
            return
        if not os.path.exists(INDEX):
            _json(self, HTTPStatus.SERVICE_UNAVAILABLE, {"error": "place index is not installed"})
            return
        # FTS5 MATCH is local and bounded. Quote terms so punctuation cannot alter the query.
        terms = _search_terms(query)
        if not terms:
            _json(self, HTTPStatus.BAD_REQUEST, {"error": "q must contain searchable characters"})
            return
        match = " AND ".join('"' + t.replace('"', '""') + '"' for t in terms)
        try:
            with closing(sqlite3.connect(INDEX)) as db:
                rows = db.execute(
                    "SELECT name, kind, lat, lon, source_id FROM places WHERE search_text MATCH ? ORDER BY rank LIMIT 20",
                    (match,),
                ).fetchall()
        except sqlite3.Error:
            rows = []
        _json(self, HTTPStatus.OK, {"query": query, "results": [
            {"id": sid, "name": n, "kind": k, "lat": lat, "lon": lon} for n, k, lat, lon, sid in rows
        ], "offline": True})

    def map_info(self):
        try:
            revision, _ = REVISION_CACHE.current(MBTILES)
        except RevisionUnavailable as error:
            _json(self, HTTPStatus.SERVICE_UNAVAILABLE, {"error": str(error)})
            return
        _json(self, HTTPStatus.OK, {"revision": revision, "minZoom": MIN_ZOOM, "maxZoom": MAX_ZOOM})

    def tile(self, z, x, y, revision):
        if z < 0 or z > 18 or x < 0 or y < 0 or x >= (1 << z) or y >= (1 << z):
            _json(self, HTTPStatus.BAD_REQUEST, {"error": "tile coordinate out of range"})
            return
        if not os.path.exists(MBTILES):
            _json(self, HTTPStatus.NOT_FOUND, {"error": "regional MBTiles is not installed"})
            return
        identity = None
        if revision is not None:
            try:
                current_revision, identity = REVISION_CACHE.current(MBTILES)
            except RevisionUnavailable as error:
                _json(self, HTTPStatus.SERVICE_UNAVAILABLE, {"error": str(error)})
                return
            if revision != current_revision:
                _json(self, HTTPStatus.CONFLICT, {"error": "requested map revision is no longer current"})
                return
        try:
            before = RevisionCache.identity(os.stat(MBTILES))
            if identity is not None and before != identity:
                _json(self, HTTPStatus.CONFLICT, {"error": "requested map revision is no longer current"})
                return
            with closing(sqlite3.connect(f"file:{MBTILES}?mode=ro", uri=True)) as db:
                row = db.execute("SELECT tile_data FROM tiles WHERE zoom_level=? AND tile_column=? AND tile_row=?", (z, x, _tile_row(z, y))).fetchone()
            after = RevisionCache.identity(os.stat(MBTILES))
        except OSError as error:
            _json(self, HTTPStatus.SERVICE_UNAVAILABLE, {"error": f"regional MBTiles cannot be read: {error.strerror or error}"})
            return
        except sqlite3.Error:
            row = None
            after = before
        if revision is not None and (before != identity or after != identity):
            _json(self, HTTPStatus.CONFLICT, {"error": "requested map revision changed during tile read"})
            return
        if not row:
            self.send_error(HTTPStatus.NOT_FOUND)
            return
        body = row[0]
        self.send_response(HTTPStatus.OK)
        self.send_header("Content-Type", "image/png")
        self.send_header("Content-Length", str(len(body)))
        self.send_header("Cache-Control", "public, max-age=31536000, immutable" if revision else "public, no-cache")
        self.end_headers()
        self.wfile.write(body)

if __name__ == "__main__":
    ThreadingHTTPServer((HOST, PORT), Handler).serve_forever()
