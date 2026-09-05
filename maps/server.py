#!/usr/bin/env python3
"""Small offline tile and place-search service for a regional transit map."""
from __future__ import annotations

import json
import math
import os
import re
import sqlite3
import urllib.parse
from http import HTTPStatus
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer

ROOT = os.path.dirname(os.path.abspath(__file__))
MBTILES = os.environ.get("MBTILES", os.path.join(ROOT, "data", "ontario.mbtiles"))
INDEX = os.environ.get("PLACE_INDEX", os.path.join(ROOT, "data", "places.sqlite3"))
HOST = os.environ.get("MAP_HOST", "0.0.0.0")
PORT = int(os.environ.get("MAP_PORT", "8789"))

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

class Handler(BaseHTTPRequestHandler):
    server_version = "GTHAOfflineMaps/1.0"
    def log_message(self, fmt, *args):
        return

    def do_GET(self):
        parsed = urllib.parse.urlparse(self.path)
        if parsed.path == "/health":
            _json(self, HTTPStatus.OK, {"ok": True, "tiles": os.path.exists(MBTILES), "index": os.path.exists(INDEX)})
            return
        if parsed.path == "/search":
            self.search(urllib.parse.parse_qs(parsed.query).get("q", [""])[0])
            return
        match = re.fullmatch(r"/tiles/(\d+)/(\d+)/(\d+)\.png", parsed.path)
        if match:
            self.tile(*(int(x) for x in match.groups()))
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
            with sqlite3.connect(INDEX) as db:
                rows = db.execute(
                    "SELECT name, kind, lat, lon, source_id FROM places WHERE search_text MATCH ? ORDER BY rank LIMIT 20",
                    (match,),
                ).fetchall()
        except sqlite3.Error:
            rows = []
        _json(self, HTTPStatus.OK, {"query": query, "results": [
            {"id": sid, "name": n, "kind": k, "lat": lat, "lon": lon} for n, k, lat, lon, sid in rows
        ], "offline": True})

    def tile(self, z, x, y):
        if z < 0 or z > 18 or x < 0 or y < 0 or x >= (1 << z) or y >= (1 << z):
            _json(self, HTTPStatus.BAD_REQUEST, {"error": "tile coordinate out of range"})
            return
        if not os.path.exists(MBTILES):
            _json(self, HTTPStatus.NOT_FOUND, {"error": "regional MBTiles is not installed"})
            return
        try:
            with sqlite3.connect(f"file:{MBTILES}?mode=ro", uri=True) as db:
                row = db.execute("SELECT tile_data FROM tiles WHERE zoom_level=? AND tile_column=? AND tile_row=?", (z, x, _tile_row(z, y))).fetchone()
        except sqlite3.Error:
            row = None
        if not row:
            self.send_error(HTTPStatus.NOT_FOUND)
            return
        body = row[0]
        self.send_response(HTTPStatus.OK)
        self.send_header("Content-Type", "image/png")
        self.send_header("Content-Length", str(len(body)))
        self.send_header("Cache-Control", "public, max-age=86400, immutable")
        self.end_headers()
        self.wfile.write(body)

if __name__ == "__main__":
    ThreadingHTTPServer((HOST, PORT), Handler).serve_forever()
