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
import unicodedata
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
    "parkway": "pkwy", "highway": "hwy", "saint": "st",
}

HIGHWAY_FORMS = {"hwy", "highway"}
SAINT_FORMS = {"st", "saint"}
STREET_FORMS = {"st", "street"}
HUB_TERMS = {"station", "terminal", "airport", "centre", "center"}
IGNORED_TERMS = {"and", "at", "the"}
MAX_SEARCH_TERMS = 12
MAX_FTS_CANDIDATES = 80


def _fold(value):
    return "".join(
        character
        for character in unicodedata.normalize("NFKD", str(value or "")).casefold()
        if not unicodedata.combining(character)
    )


def _raw_terms(value):
    return re.sub(r"[^0-9a-z]+", " ", _fold(value)).split()


def _search_terms(query):
    return [ALIASES.get(word, word) for word in _raw_terms(query) if word not in IGNORED_TERMS]

def _numeric(term):
    return term.isdigit()


def _highway_context(terms, index):
    return (
        (index > 0 and _numeric(terms[index - 1]))
        or (index + 1 < len(terms) and _numeric(terms[index + 1]))
    )


def _term_forms(terms, index):
    term = terms[index]
    forms = {term}
    if term in HIGHWAY_FORMS:
        forms.update(HIGHWAY_FORMS)
    if term in SAINT_FORMS:
        forms.update(SAINT_FORMS)
        forms.update(STREET_FORMS)
    if term in {"high", "route"} and _highway_context(terms, index):
        forms.add("hwy")
    return forms


def _term_match(query_terms, query_index, candidate_terms, candidate_index):
    query_term = query_terms[query_index]
    query_forms = _term_forms(query_terms, query_index)
    candidate_forms = _term_forms(candidate_terms, candidate_index)
    if query_forms & candidate_forms:
        return 0
    if not _numeric(query_term) and query_term != "st" and len(query_term) >= 2 and any(
        candidate.startswith(query_term) for candidate in candidate_forms
    ):
        return 1
    return None


def _best_term_match(query_terms, query_index, candidate_terms):
    best = None
    for candidate_index in range(len(candidate_terms)):
        quality = _term_match(query_terms, query_index, candidate_terms, candidate_index)
        if quality is not None and (
            best is None or (quality, candidate_index) < (best[0], best[1])
        ):
            best = (quality, candidate_index)
    return best


def _exact_phrase_index(query_terms, candidate_terms):
    for start in range(len(candidate_terms) - len(query_terms) + 1):
        if all(
            _term_match(query_terms, index, candidate_terms, start + index) == 0
            for index in range(len(query_terms))
        ):
            return start
    return -1


def _fts_term(term):
    return f'"{term}"' if _numeric(term) or term == "st" else f'"{term}"*'


def _fts_match(terms):
    return " AND ".join(
        "(" + " OR ".join(_fts_term(form) for form in sorted(_term_forms(terms, index))) + ")"
        for index in range(len(terms))
    )


def _place_rank(row, query_terms):
    name, kind, _lat, _lon, source_id = row
    name_terms = _search_terms(name)
    matches = [_best_term_match(query_terms, index, name_terms) for index in range(len(query_terms))]
    all_name_terms_match = all(match is not None for match in matches)
    all_name_terms_exact = all_name_terms_match and all(match[0] == 0 for match in matches)
    exact = all_name_terms_exact and len(name_terms) == len(query_terms)
    forward_phrase = _exact_phrase_index(query_terms, name_terms) if all_name_terms_exact else -1
    reverse_phrase = _exact_phrase_index(list(reversed(query_terms)), name_terms) if all_name_terms_exact else -1
    phrase_positions = [index for index in (forward_phrase, reverse_phrase) if index >= 0]
    phrase_index = min(phrase_positions) if phrase_positions else 999
    hub = any(term in HUB_TERMS for term in name_terms)
    if exact:
        tier = 0
    elif all_name_terms_exact and hub:
        tier = 1
    elif all_name_terms_exact and kind == "intersection":
        tier = 2
    elif all_name_terms_exact and phrase_positions:
        tier = 3
    elif all_name_terms_exact:
        tier = 4
    elif all_name_terms_match and kind == "intersection":
        tier = 5
    else:
        tier = 6
    prefix_count = sum(match[0] == 1 for match in matches if match is not None)
    return (tier, prefix_count, phrase_index, len(name_terms), _fold(name), str(source_id))


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
        # FTS5 MATCH is local and bounded. Terms are folded before its quoted prefix syntax.
        terms = _search_terms(query)
        if not terms:
            _json(self, HTTPStatus.BAD_REQUEST, {"error": "q must contain searchable characters"})
            return
        if len(terms) > MAX_SEARCH_TERMS:
            _json(self, HTTPStatus.BAD_REQUEST, {"error": f"q must contain at most {MAX_SEARCH_TERMS} searchable terms"})
            return
        match = _fts_match(terms)
        try:
            with closing(sqlite3.connect(INDEX)) as db:
                rows = db.execute(
                    "SELECT name, kind, lat, lon, source_id FROM places WHERE places MATCH ? ORDER BY rank LIMIT ?",
                    (match, MAX_FTS_CANDIDATES),
                ).fetchall()
        except sqlite3.Error:
            rows = []
        rows.sort(key=lambda row: _place_rank(row, terms))
        _json(self, HTTPStatus.OK, {"query": query, "results": [
            {"id": sid, "name": n, "kind": k, "lat": lat, "lon": lon} for n, k, lat, lon, sid in rows[:20]
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
