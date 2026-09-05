#!/usr/bin/env python3
"""Render regional OSM linework and labels to raster MBTiles."""
from __future__ import annotations

import io
import json
import math
import os
import sqlite3
import sys

from PIL import Image, ImageDraw, ImageFont

WEST, NORTH, EAST, SOUTH = -80.4, 44.55, -78.3, 43.05
ROAD_STYLE = {
    "motorway": ((224, 137, 84), 7), "motorway_link": ((224, 137, 84), 4),
    "trunk": ((228, 157, 91), 6), "trunk_link": ((228, 157, 91), 4),
    "primary": ((238, 190, 104), 5), "primary_link": ((238, 190, 104), 3),
    "secondary": ((245, 213, 135), 4), "secondary_link": ((245, 213, 135), 3),
    "tertiary": ((250, 235, 181), 3), "residential": ((255, 255, 255), 2),
    "tertiary_link": ((250, 235, 181), 2), "unclassified": ((250, 250, 248), 2),
    "living_street": ((250, 250, 248), 2), "service": ((224, 223, 217), 1),
    "footway": ((202, 201, 194), 1), "path": ((202, 201, 194), 1),
    "cycleway": ((177, 202, 183), 1), "pedestrian": ((212, 211, 203), 1),
    "steps": ((202, 201, 194), 1), "track": ((210, 199, 177), 1),
}

ROAD_KINDS_BY_MIN_ZOOM = {
    8: {"motorway", "motorway_link", "trunk", "trunk_link", "primary", "primary_link"},
    11: {"secondary", "secondary_link", "tertiary", "tertiary_link"},
    12: {"residential", "unclassified", "living_street"},
    13: {"service", "footway", "path", "cycleway", "pedestrian", "steps", "track"},
}

ROAD_PAINT_ORDER = {
    kind: rank
    for rank, kinds in enumerate(reversed(tuple(ROAD_KINDS_BY_MIN_ZOOM.values())))
    for kind in kinds
}

def project(lon, lat, zoom):
    count = 1 << zoom
    return ((lon + 180) / 360 * count,
            (1 - math.asinh(math.tan(math.radians(lat))) / math.pi) / 2 * count)

def draw_label(draw, xy, text, fill, font, occupied):
    x, y = xy
    box = draw.textbbox((x, y), text, font=font, anchor="mm", stroke_width=2)
    if box[0] < 2 or box[1] < 2 or box[2] > 254 or box[3] > 254:
        return False
    padded = (box[0] - 3, box[1] - 2, box[2] + 3, box[3] + 2)
    if any(not (padded[2] < prior[0] or padded[0] > prior[2] or
                padded[3] < prior[1] or padded[1] > prior[3]) for prior in occupied):
        return False
    draw.text((x, y), text, font=font, anchor="mm", fill=fill,
              stroke_width=2, stroke_fill=(248, 247, 242))
    occupied.append(padded)
    return True

def visible_road_kinds(zoom):
    visible = set()
    for minimum_zoom, kinds in ROAD_KINDS_BY_MIN_ZOOM.items():
        if zoom >= minimum_zoom:
            visible.update(kinds)
    return visible

def render_tile(db, zoom, x, y, font=None):
    count = 1 << zoom
    image = Image.new("RGB", (256, 256), (242, 240, 233))
    draw = ImageDraw.Draw(image)
    occupied = []
    font = font or ImageFont.load_default()
    invx = lambda value: value / count * 360 - 180
    invy = lambda value: math.degrees(math.atan(math.sinh(math.pi * (1 - 2 * value / count))))
    lon0, lon1 = invx(x), invx(x + 1)
    lat1, lat0 = invy(y), invy(y + 1)
    bbox = (lon0, lon1, lat0, lat1)
    for raw, in db.execute("""SELECT water.geometry FROM water_rtree
        JOIN water ON water.rowid=water_rtree.id
        WHERE water_rtree.maxlon>=? AND water_rtree.minlon<=?
        AND water_rtree.maxlat>=? AND water_rtree.minlat<=?""", bbox):
        points = [((project(a, b, zoom)[0] - x) * 256, (project(a, b, zoom)[1] - y) * 256)
                  for a, b in json.loads(raw)]
        draw.line(points, fill=(139, 194, 220), width=3)
    visible = visible_road_kinds(zoom)
    roads = db.execute("""SELECT roads.id,roads.kind,roads.name,roads.geometry FROM roads_rtree
        JOIN roads ON roads.rowid=roads_rtree.id
        WHERE roads_rtree.maxlon>=? AND roads_rtree.minlon<=?
        AND roads_rtree.maxlat>=? AND roads_rtree.minlat<=?""", bbox).fetchall()
    roads = sorted((road for road in roads if road[1] in visible),
                   key=lambda road: (ROAD_PAINT_ORDER[road[1]], road[0]))
    labelled = set()
    for _, kind, name, raw in roads:
        color, base_width = ROAD_STYLE[kind]
        width = max(1, base_width - max(0, 11 - zoom))
        points = [((project(a, b, zoom)[0] - x) * 256, (project(a, b, zoom)[1] - y) * 256)
                  for a, b in json.loads(raw)]
        if width >= 3:
            draw.line(points, fill=(188, 184, 174), width=width + 2, joint="curve")
        draw.line(points, fill=color, width=width, joint="curve")
        label_kinds = {"motorway", "trunk", "primary", "secondary"}
        if zoom >= 12 and name and kind in label_kinds and name not in labelled and len(points) > 1:
            middle = points[len(points) // 2]
            if draw_label(draw, middle, name, (68, 67, 63), font, occupied):
                labelled.add(name)
    minimum_kind = (("city", "town", "village") if zoom <= 10 else
                    ("city", "town", "village", "suburb", "neighbourhood", "station"))
    marks = ",".join("?" for _ in minimum_kind)
    for name, kind, lat, lon in db.execute(
        f"SELECT name,kind,lat,lon FROM labels WHERE lon>=? AND lon<=? AND lat>=? AND lat<=? AND kind IN ({marks}) LIMIT 30",
        (lon0, lon1, lat0, lat1, *minimum_kind)):
        point = ((project(lon, lat, zoom)[0] - x) * 256, (project(lon, lat, zoom)[1] - y) * 256)
        draw_label(draw, point, name, (39, 56, 66), font, occupied)
    return image

def main(source, target):
    db = sqlite3.connect(source)
    temporary = target + ".tmp"
    if os.path.exists(temporary):
        os.unlink(temporary)
    out = sqlite3.connect(temporary)
    out.executescript("""CREATE TABLE metadata(name TEXT,value TEXT);
        CREATE TABLE tiles(zoom_level INTEGER,tile_column INTEGER,tile_row INTEGER,tile_data BLOB,
        PRIMARY KEY(zoom_level,tile_column,tile_row));""")
    out.executemany("INSERT INTO metadata VALUES (?,?)", [
        ("name", "GTHA OpenStreetMap raster"), ("format", "png"),
        ("minzoom", "8"), ("maxzoom", "13"),
        ("bounds", f"{WEST},{SOUTH},{EAST},{NORTH}"),
        ("attribution", "© OpenStreetMap contributors"),
    ])
    font = ImageFont.load_default()
    for zoom in range(8, 14):
        count = 1 << zoom
        x0 = max(0, int(project(WEST, 0, zoom)[0]) - 1)
        x1 = min(count, int(project(EAST, 0, zoom)[0]) + 2)
        y0 = max(0, int(project(0, NORTH, zoom)[1]) - 1)
        y1 = min(count, int(project(0, SOUTH, zoom)[1]) + 2)
        for x in range(x0, x1):
            for y in range(y0, y1):
                image = render_tile(db, zoom, x, y, font)
                buffer = io.BytesIO()
                image.save(buffer, format="PNG", optimize=True)
                out.execute("INSERT INTO tiles VALUES (?,?,?,?)", (zoom, x, count - 1 - y, buffer.getvalue()))
        out.commit()
        print(f"Rendered zoom {zoom}")
    db.close()
    out.close()
    os.replace(temporary, target)

if __name__ == "__main__":
    if len(sys.argv) != 3:
        raise SystemExit("usage: render_mbtiles.py data/places.sqlite3 data/ontario.mbtiles")
    main(sys.argv[1], sys.argv[2])
