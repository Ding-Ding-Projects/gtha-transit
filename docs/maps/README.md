# Offline regional map service

This service supplies the transit planner with regional raster tiles and local place search on port 8789. It makes no network request at runtime. Address and place lookup uses `/search?q=...`.

Clients should request `/map-info` before creating a tile layer. The response contains the SHA-256 revision of the actual MBTiles file plus `minZoom` and `maxZoom`, and is always served with `Cache-Control: no-store`. Use that revision in `/tiles/{revision}/{z}/{x}/{y}.png`. A matching versioned tile is immutable; a stale revision receives HTTP 409 and never receives bytes from the replacement dataset.

The service streams the MBTiles hash in bounded chunks and caches it by device, inode, size, and nanosecond modification time. Hash calculation is serialized with a bounded wait. The file identity is verified before and after hashing and before and after a versioned SQLite tile read, so an atomic file replacement cannot publish new bytes under an old revision. The legacy `/tiles/{z}/{x}/{y}.png` route remains available with `Cache-Control: public, no-cache` for older clients.

## Data choice

Use an Ontario OpenStreetMap extract from Geofabrik as the source for a regional build. The extract is available at <https://download.geofabrik.de/north-america/canada/ontario.html> and is suitable for Osmium and other OSM import tools. Build an MBTiles output with a pinned OpenMapTiles or equivalent local toolchain, then copy it to `maps/data/ontario.mbtiles`. TileServer GL is a supported alternative renderer for MBTiles when vector styling is preferred, but the included service is deliberately smaller and preserves the existing raster URL contract.

OpenStreetMap data is licensed under the ODbL. The running map must display `© OpenStreetMap contributors` and link to <https://www.openstreetmap.org/copyright>. Do not use the public OSM tile or Nominatim services in production. All tiles and search records served by this service must be generated and stored on the local host.

## Place index

The direct PBF importer builds the place index from actual OSM objects. It includes named nodes, `addr:housenumber` plus `addr:street` nodes and ways, and intersections where two differently named highway ways share an OSM node. Intersection coordinates are always those of the shared node; the importer does not invent a midpoint for roads that merely pass near one another. Address display names include `addr:city` or `addr:place` when the source supplies one.

Search normalization treats `&`, `/`, `and`, and `at` as equivalent separators. Common road suffixes and `Hwy`/`Highway` are normalized to the same indexed terms. The public result keeps the source spelling and stable OSM element or shared-node identifier.

For an external curated input, export address and place rows from the same regional OSM extract into a UTF-8 tab-separated file with `name`, `kind`, `lat`, `lon`, and `source_id` columns. Build the bounded FTS5 index:

```text
python maps/import_places.py places.tsv maps/data/places.sqlite3
```

`source_id` should be the stable OSM element identifier, allowing results to be audited without storing the full source object. The service limits a query to 120 characters and 20 results. It quotes terms before FTS matching, so user punctuation cannot become a query expression.

For direct PBF extraction, run the pinned importer and renderer. The PyPI distribution is named `osmium` (the Python module imported by the script):

```text
python maps/import_osm.py ontario.osm.pbf maps/data/places.sqlite3
python maps/render_mbtiles.py maps/data/places.sqlite3 maps/data/ontario.mbtiles
```

The importer reads actual OSM nodes and ways, retaining named places, addresses, shared-node intersections, roads, waterways, and coastline geometry. FTS5 backs text search and SQLite RTree tables bound the geometry reads. The temporary road-vertex table is stored on disk and removed after intersections are created. The renderer produces zoom 8 through 13 PNG tiles for the GTHA region, styles roads by OSM highway class, and labels cities and major roads with collision checks. A nonempty road tile therefore comes from real regional data, not a placeholder.

## Run

```text
docker compose -f maps/docker-compose.yml up -d --build
```

The service listens on port 8789. Check `/health`, request a tile inside the documented MBTiles bounds, or query `/search?q=Union%20Station`. Keep MBTiles and the SQLite index outside version control because they are generated regional data. Back up their source revision and build manifest beside the deployment record.

## Verification

Before connecting the planner, verify that `/health` reports both data files, `/map-info` returns the actual file digest, a revision-bound known tile returns a decodable nonempty `image/png`, an unknown tile returns 404, and a valid query returns `offline: true`. Atomically replace a temporary test database, confirm its revision changes, and confirm the old revision returns 409 with `no-store` rather than current tile bytes. Verify at least one known intersection using `and`, `at`, `&`, or `/`, and inspect its shared-node source identifier and coordinates. Confirm outbound network access is disabled for the container. The map view must retain visible OSM attribution.
