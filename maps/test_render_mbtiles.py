#!/usr/bin/env python3
"""Focused road-visibility and paint-order tests for raster map tiles."""
from __future__ import annotations

import json
import sqlite3
import unittest

import render_mbtiles as renderer


class RoadVisibilityTest(unittest.TestCase):
    def test_visibility_inventory_at_every_rendered_zoom(self):
        cumulative = set()
        expected = {}
        for zoom in range(8, 14):
            cumulative.update(renderer.ROAD_KINDS_BY_MIN_ZOOM.get(zoom, set()))
            expected[zoom] = set(cumulative)

        self.assertEqual(renderer.visible_road_kinds(7), set())
        for zoom in range(8, 14):
            self.assertEqual(renderer.visible_road_kinds(zoom), expected[zoom])
            self.assertNotIn("unknown_highway_kind", renderer.visible_road_kinds(zoom))
        self.assertEqual(set(renderer.ROAD_STYLE), expected[13])

    def test_actual_tile_hides_minor_at_11_shows_it_at_13_and_paints_major_on_top(self):
        database = sqlite3.connect(":memory:")
        self.addCleanup(database.close)
        database.executescript("""
            CREATE TABLE roads(id TEXT PRIMARY KEY, kind TEXT, name TEXT, ref TEXT,
              geometry TEXT, minlon REAL, minlat REAL, maxlon REAL, maxlat REAL);
            CREATE VIRTUAL TABLE roads_rtree USING rtree(id,minlon,maxlon,minlat,maxlat);
            CREATE TABLE water(id TEXT PRIMARY KEY, kind TEXT, name TEXT,
              geometry TEXT, minlon REAL, minlat REAL, maxlon REAL, maxlat REAL);
            CREATE VIRTUAL TABLE water_rtree USING rtree(id,minlon,maxlon,minlat,maxlat);
            CREATE TABLE labels(id TEXT PRIMARY KEY, name TEXT, kind TEXT, lat REAL, lon REAL);
        """)
        lon, lat = -79.4, 43.65
        self._road(database, "major", "primary", [[lon, lat - 0.02], [lon, lat + 0.02]])
        self._road(database, "minor", "footway", [[lon - 0.02, lat], [lon + 0.02, lat]])

        zoom11, x11, y11 = self._tile(lon, lat, 11)
        image11 = renderer.render_tile(database, zoom11, x11, y11)
        minor_x11, minor_y11 = self._pixel(lon + 0.01, lat, zoom11, x11, y11)
        self.assertFalse(self._has_color(image11, minor_x11, minor_y11, renderer.ROAD_STYLE["footway"][0]))

        zoom13, x13, y13 = self._tile(lon, lat, 13)
        image13 = renderer.render_tile(database, zoom13, x13, y13)
        minor_x13, minor_y13 = self._pixel(lon + 0.01, lat, zoom13, x13, y13)
        self.assertTrue(self._has_color(image13, minor_x13, minor_y13, renderer.ROAD_STYLE["footway"][0]))
        centre_x, centre_y = self._pixel(lon, lat, zoom13, x13, y13)
        self.assertTrue(self._has_color(image13, centre_x, centre_y, renderer.ROAD_STYLE["primary"][0], radius=1))
        self.assertFalse(self._has_color(image13, centre_x, centre_y, renderer.ROAD_STYLE["footway"][0], radius=0))

    @staticmethod
    def _road(database, road_id, kind, geometry):
        xs = [point[0] for point in geometry]
        ys = [point[1] for point in geometry]
        cursor = database.execute("INSERT INTO roads VALUES (?,?,?,?,?,?,?,?,?)",
            (road_id, kind, None, None, json.dumps(geometry), min(xs), min(ys), max(xs), max(ys)))
        database.execute("INSERT INTO roads_rtree VALUES (?,?,?,?,?)",
            (cursor.lastrowid, min(xs), max(xs), min(ys), max(ys)))

    @staticmethod
    def _tile(lon, lat, zoom):
        projected_x, projected_y = renderer.project(lon, lat, zoom)
        return zoom, int(projected_x), int(projected_y)

    @staticmethod
    def _pixel(lon, lat, zoom, tile_x, tile_y):
        projected_x, projected_y = renderer.project(lon, lat, zoom)
        return int((projected_x - tile_x) * 256), int((projected_y - tile_y) * 256)

    @staticmethod
    def _has_color(image, x, y, color, radius=2):
        for check_x in range(max(0, x - radius), min(256, x + radius + 1)):
            for check_y in range(max(0, y - radius), min(256, y + radius + 1)):
                if image.getpixel((check_x, check_y)) == color:
                    return True
        return False


if __name__ == "__main__":
    unittest.main()
