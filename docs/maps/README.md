# Offline regional map service

This service supplies the transit planner with regional raster tiles and local place search. It makes no network request at runtime. The map client can keep using `/tiles/{z}/{x}/{y}.png`; address and place lookup uses `/search?q=...`.

## Data choice

Use an Ontario OpenStreetMap extract from Geofabrik as the source for a regional build. The extract is available at <https://download.geofabrik.de/north-america/canada/ontario.html> and is suitable for Osmium and other OSM import tools. Build an MBTiles output with a pinned OpenMapTiles or equivalent local toolchain, then copy it to `maps/data/ontario.mbtiles`. TileServer GL is a supported alternative renderer for MBTiles when vector styling is preferred, but the included service is deliberately smaller and preserves the existing raster URL contract.

OpenStreetMap data is licensed under the ODbL. The running map must display `© OpenStreetMap contributors` and link to <https://www.openstreetmap.org/copyright>. Do not use the public OSM tile or Nominatim services in production. All tiles and search records served by this service must be generated and stored on the local host.

## Place index

Export address and place rows from the same regional OSM extract into a UTF-8 tab-separated file with `name`, `kind`, `lat`, `lon`, and `source_id` columns. Build the bounded FTS5 index:

```text
python maps/import_places.py places.tsv maps/data/places.sqlite3
```

`source_id` should be the stable OSM element identifier, allowing results to be audited without storing the full source object. The service limits a query to 120 characters and 20 results. It quotes terms before FTS matching, so user punctuation cannot become a query expression.

## Run

```text
docker compose -f maps/docker-compose.yml up -d --build
```

The service listens on port 8787. Check `/health`, request `/tiles/12/1200/1500.png`, or query `/search?q=Union%20Station`. Mount `maps/data` read-only in the container. Keep MBTiles and the SQLite index outside version control because they are generated regional data. Back up their source revision and build manifest beside the deployment record.

## Verification

Before connecting the planner, verify that `/health` reports both data files, a known tile returns `image/png`, an unknown tile returns 404, a valid query returns `offline: true`, and an empty or oversized query returns 400. Confirm outbound network access is disabled for the container. The map view must retain visible OSM attribution.
