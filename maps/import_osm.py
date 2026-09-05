#!/usr/bin/env python3
"""Build a bounded regional search and rendering index from an OSM PBF."""
from __future__ import annotations

import json
import os
import re
import sqlite3
import sys

import osmium

WEST, SOUTH, EAST, NORTH = -80.4, 43.05, -78.3, 44.55

def in_region(lon: float, lat: float) -> bool:
    return WEST <= lon <= EAST and SOUTH <= lat <= NORTH

def canonical(text: str) -> str:
    value = re.sub(r"[^0-9a-z]+", " ", text.casefold()).strip()
    aliases = {
        "avenue": "ave", "av": "ave", "road": "rd", "street": "st",
        "boulevard": "blvd", "drive": "dr", "lane": "ln", "court": "ct",
        "parkway": "pkwy", "highway": "hwy", "route": "hwy",
    }
    return " ".join(aliases.get(word, word) for word in value.split()
                    if word not in {"and", "at", "the"})

def road_label(tags) -> str | None:
    name = tags.get("name")
    ref = tags.get("ref")
    if name:
        return name
    if ref:
        return f"Highway {ref}" if tags.get("highway") in {"motorway", "trunk", "primary"} else ref
    return None

def address_label(tags) -> str | None:
    street = tags.get("addr:street")
    number = tags.get("addr:housenumber")
    if not street or not number:
        return None
    locality = tags.get("addr:city") or tags.get("addr:place")
    base = f"{number} {street}"
    return f"{base}, {locality}" if locality else base

class Handler(osmium.SimpleHandler):
    def __init__(self, db: sqlite3.Connection):
        super().__init__()
        self.db = db
        self.pending = 0

    def flush(self) -> None:
        self.pending += 1
        if self.pending >= 20_000:
            self.db.commit()
            self.pending = 0

    def node(self, obj) -> None:
        try:
            lon, lat = float(obj.location.lon), float(obj.location.lat)
        except (AttributeError, RuntimeError):
            return
        if not in_region(lon, lat):
            return
        name = obj.tags.get("name")
        display = address_label(obj.tags)
        if display:
            self.db.execute("INSERT INTO places VALUES (?,?,?,?,?,?)",
                            (display, canonical(display), "address", lat, lon, f"node/{obj.id}"))
        if name:
            kind = obj.tags.get("place") or obj.tags.get("railway") or obj.tags.get("amenity") or "place"
            self.db.execute("INSERT INTO places VALUES (?,?,?,?,?,?)",
                            (name, canonical(name), kind, lat, lon, f"node/{obj.id}"))
            if kind in {"city", "town", "village", "suburb", "neighbourhood", "station"}:
                self.db.execute("INSERT INTO labels VALUES (?,?,?,?,?)",
                                (f"node/{obj.id}", name, kind, lat, lon))
        self.flush()

    def way(self, obj) -> None:
        try:
            line = [[float(node.lon), float(node.lat)] for node in obj.nodes]
        except (AttributeError, RuntimeError):
            return
        if len(line) < 2:
            return
        xs = [point[0] for point in line]
        ys = [point[1] for point in line]
        if max(xs) < WEST or min(xs) > EAST or max(ys) < SOUTH or min(ys) > NORTH:
            return
        highway = obj.tags.get("highway")
        water = obj.tags.get("waterway") or obj.tags.get("natural")
        geometry = json.dumps(line, separators=(",", ":"))
        if highway:
            label = road_label(obj.tags)
            cursor = self.db.execute("INSERT INTO roads VALUES (?,?,?,?,?,?,?,?,?)",
                (str(obj.id), highway, label, obj.tags.get("ref"), geometry,
                 min(xs), min(ys), max(xs), max(ys)))
            self.db.execute("INSERT INTO roads_rtree VALUES (?,?,?,?,?)",
                            (cursor.lastrowid, min(xs), max(xs), min(ys), max(ys)))
            if label:
                road_key = canonical(label)
                for node, point in zip(obj.nodes, line):
                    if in_region(point[0], point[1]):
                        self.db.execute("INSERT OR IGNORE INTO road_vertices VALUES (?,?,?,?,?,?)",
                            (int(node.ref), str(obj.id), label, road_key, point[1], point[0]))
        if water in {"river", "stream", "canal", "coastline", "water"}:
            cursor = self.db.execute("INSERT INTO water VALUES (?,?,?,?,?,?,?,?)",
                (str(obj.id), water, obj.tags.get("name"), geometry,
                 min(xs), min(ys), max(xs), max(ys)))
            self.db.execute("INSERT INTO water_rtree VALUES (?,?,?,?,?)",
                            (cursor.lastrowid, min(xs), max(xs), min(ys), max(ys)))
        display = address_label(obj.tags)
        if display:
            self.db.execute("INSERT INTO places VALUES (?,?,?,?,?,?)",
                (display, canonical(display), "address", sum(ys) / len(ys), sum(xs) / len(xs), f"way/{obj.id}"))
        self.flush()

def add_intersections(db: sqlite3.Connection) -> int:
    junctions = db.execute("""SELECT node_id, MIN(lat), MIN(lon) FROM road_vertices
        GROUP BY node_id HAVING COUNT(DISTINCT road_key) >= 2""").fetchall()
    inserted = 0
    for node_id, lat, lon in junctions:
        roads = db.execute("""SELECT road_key, MIN(road_name) FROM road_vertices
            WHERE node_id=? GROUP BY road_key ORDER BY road_key""", (node_id,)).fetchall()
        for index, (left_key, left_name) in enumerate(roads):
            for right_key, right_name in roads[index + 1:]:
                name = f"{left_name} & {right_name}"
                db.execute("INSERT INTO places VALUES (?,?,?,?,?,?)",
                    (name, f"{left_key} {right_key} intersection", "intersection", lat, lon,
                     f"intersection/node/{node_id}/{left_key}/{right_key}"))
                inserted += 1
    return inserted

def main(source: str, target: str) -> None:
    os.makedirs(os.path.dirname(os.path.abspath(target)), exist_ok=True)
    temporary = target + ".tmp"
    if os.path.exists(temporary):
        os.unlink(temporary)
    db = sqlite3.connect(temporary)
    db.execute("PRAGMA journal_mode=WAL")
    db.execute("PRAGMA synchronous=NORMAL")
    db.executescript("""
        CREATE TABLE roads(id TEXT PRIMARY KEY, kind TEXT, name TEXT, ref TEXT,
          geometry TEXT, minlon REAL, minlat REAL, maxlon REAL, maxlat REAL);
        CREATE TABLE water(id TEXT PRIMARY KEY, kind TEXT, name TEXT,
          geometry TEXT, minlon REAL, minlat REAL, maxlon REAL, maxlat REAL);
        CREATE TABLE road_vertices(node_id INTEGER, road_id TEXT, road_name TEXT,
          road_key TEXT, lat REAL, lon REAL, PRIMARY KEY(node_id, road_id));
        CREATE TABLE labels(id TEXT PRIMARY KEY, name TEXT, kind TEXT, lat REAL, lon REAL);
        CREATE INDEX roads_bbox ON roads(minlon,maxlon,minlat,maxlat);
        CREATE INDEX water_bbox ON water(minlon,maxlon,minlat,maxlat);
        CREATE VIRTUAL TABLE roads_rtree USING rtree(id,minlon,maxlon,minlat,maxlat);
        CREATE VIRTUAL TABLE water_rtree USING rtree(id,minlon,maxlon,minlat,maxlat);
        CREATE INDEX road_vertices_node ON road_vertices(node_id,road_key);
        CREATE INDEX labels_point ON labels(lon,lat);
        CREATE VIRTUAL TABLE places USING fts5(name,search_text,kind UNINDEXED,
          lat UNINDEXED,lon UNINDEXED,source_id UNINDEXED,
          tokenize='unicode61 remove_diacritics 2');
    """)
    Handler(db).apply_file(source, locations=True)
    db.commit()
    intersections = add_intersections(db)
    db.execute("DROP TABLE road_vertices")
    db.commit()
    db.execute("PRAGMA optimize")
    db.close()
    for suffix in ("-wal", "-shm"):
        sidecar = temporary + suffix
        if os.path.exists(sidecar):
            os.unlink(sidecar)
    os.replace(temporary, target)
    print(f"Indexed {intersections} shared-node road intersections")

if __name__ == "__main__":
    if len(sys.argv) != 3:
        raise SystemExit("usage: import_osm.py input.osm.pbf data/places.sqlite3")
    main(sys.argv[1], sys.argv[2])
