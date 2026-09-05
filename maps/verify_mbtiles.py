#!/usr/bin/env python3
"""Verify a candidate regional MBTiles file before atomic promotion."""
from __future__ import annotations

import argparse
import hashlib
import io
import json
import os
import sqlite3
import sys
import urllib.parse
from contextlib import closing

from PIL import Image

MIN_ZOOM = 8
MAX_ZOOM = 13
HASH_CHUNK_SIZE = 1024 * 1024


class VerificationError(Exception):
    pass


def readonly_connection(path):
    absolute = os.path.abspath(path).replace("\\", "/")
    uri = "file:" + urllib.parse.quote(absolute, safe="/:") + "?mode=ro"
    return sqlite3.connect(uri, uri=True)


def file_sha256(path):
    digest = hashlib.sha256()
    with open(path, "rb") as source:
        while chunk := source.read(HASH_CHUNK_SIZE):
            digest.update(chunk)
    return digest.hexdigest()


def inspect_database(path, decode_tiles):
    try:
        initial_stat = os.stat(path)
        initial_identity = (initial_stat.st_dev, initial_stat.st_ino, initial_stat.st_size, initial_stat.st_mtime_ns)
        file_size = initial_stat.st_size
        digest = file_sha256(path)
        with closing(readonly_connection(path)) as database:
            integrity = database.execute("PRAGMA integrity_check").fetchall()
            if integrity != [("ok",)]:
                raise VerificationError("SQLite integrity_check did not return ok")
            metadata = dict(database.execute("SELECT name,value FROM metadata"))
            required = {"format": "png", "minzoom": str(MIN_ZOOM), "maxzoom": str(MAX_ZOOM)}
            for name, expected in required.items():
                if metadata.get(name) != expected:
                    raise VerificationError(f"metadata {name} must equal {expected}")
            outside = database.execute(
                "SELECT COUNT(*) FROM tiles WHERE zoom_level<? OR zoom_level>?",
                (MIN_ZOOM, MAX_ZOOM),
            ).fetchone()[0]
            if outside:
                raise VerificationError("tiles exist outside zoom levels 8 through 13")
            counts = {}
            tile_bytes = {}
            keys = {}
            for zoom in range(MIN_ZOOM, MAX_ZOOM + 1):
                rows = database.execute(
                    "SELECT tile_column,tile_row,LENGTH(tile_data) FROM tiles WHERE zoom_level=?",
                    (zoom,),
                ).fetchall()
                if not rows:
                    raise VerificationError(f"zoom {zoom} contains no tiles")
                limit = 1 << zoom
                if any(x < 0 or x >= limit or tms_y < 0 or tms_y >= limit for x, tms_y, _ in rows):
                    raise VerificationError(f"zoom {zoom} contains out-of-range tile coordinates")
                keys[zoom] = {(x, (1 << zoom) - 1 - tms_y) for x, tms_y, _ in rows}
                if len(keys[zoom]) != len(rows):
                    raise VerificationError(f"zoom {zoom} contains duplicate XYZ tile coordinates")
                counts[str(zoom)] = len(rows)
                tile_bytes[str(zoom)] = sum(length or 0 for _, _, length in rows)
            if decode_tiles:
                for zoom, x, tms_y, body in database.execute(
                    "SELECT zoom_level,tile_column,tile_row,tile_data FROM tiles ORDER BY zoom_level,tile_column,tile_row"
                ):
                    xyz_y = (1 << zoom) - 1 - tms_y
                    try:
                        with Image.open(io.BytesIO(body)) as image:
                            image_format = image.format
                            image_size = image.size
                            image.verify()
                        with Image.open(io.BytesIO(body)) as image:
                            image.load()
                    except Exception as error:
                        raise VerificationError(
                            f"tile {zoom}/{x}/{xyz_y} is not a decodable PNG: {error}"
                        ) from error
                    if image_format != "PNG" or image_size != (256, 256):
                        raise VerificationError(
                            f"tile {zoom}/{x}/{xyz_y} must be a 256x256 PNG"
                        )
        final_stat = os.stat(path)
        final_identity = (final_stat.st_dev, final_stat.st_ino, final_stat.st_size, final_stat.st_mtime_ns)
        if final_identity != initial_identity:
            raise VerificationError("MBTiles file changed during verification")
    except (OSError, sqlite3.Error) as error:
        raise VerificationError(f"MBTiles read failed: {error}") from error
    return {
        "sha256": digest,
        "fileBytes": file_size,
        "tileBytesByZoom": tile_bytes,
        "tileCountByZoom": counts,
        "keys": keys,
    }


def verify(candidate_path, baseline_path):
    baseline = inspect_database(baseline_path, decode_tiles=True)
    candidate = inspect_database(candidate_path, decode_tiles=True)
    for zoom in range(MIN_ZOOM, MAX_ZOOM + 1):
        missing = baseline["keys"][zoom] - candidate["keys"][zoom]
        extra = candidate["keys"][zoom] - baseline["keys"][zoom]
        if missing or extra:
            raise VerificationError(
                f"zoom {zoom} XYZ coverage differs: {len(missing)} missing, {len(extra)} extra"
            )
    for result in (baseline, candidate):
        result.pop("keys")
    return {
        "ok": True,
        "zoomRange": {"min": MIN_ZOOM, "max": MAX_ZOOM},
        "baseline": baseline,
        "candidate": candidate,
    }


def main(argv=None):
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("candidate", help="candidate MBTiles file")
    parser.add_argument("baseline", help="current baseline MBTiles file")
    arguments = parser.parse_args(argv)
    try:
        report = verify(arguments.candidate, arguments.baseline)
    except VerificationError as error:
        print(json.dumps({"ok": False, "error": str(error)}, separators=(",", ":")))
        return 1
    print(json.dumps(report, separators=(",", ":"), sort_keys=True))
    return 0


if __name__ == "__main__":
    sys.exit(main())
