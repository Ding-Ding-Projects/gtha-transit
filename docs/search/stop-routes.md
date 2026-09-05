# Scheduled routes at a stop

The planner can attach a bounded list of scheduled routes to each transit-stop suggestion. This data answers which routes are present in a validated GTFS schedule. It does not report vehicle positions, imminent departures, arrival predictions, service alerts, or live availability.

## Source and validity

`scripts/data/build-stop-index.py` accepts only ZIP archives named in `data/feeds/manifest.json`. Before reading a feed, it validates the manifest schema and batch generation receipt, verifies that the archive exists, has the manifest's SHA-256 receipt, contains the required GTFS members, and has no corrupt member. The generated index records the manifest digest, batch receipt, archive version, source and publisher URLs, archive digest and size, service range, promotion or retirement boundary, and exact record counts.

The generator writes three coordinated local indexes:

- `data/stops.json` contains search-ready stops.
- `data/routes.json` contains route badges and their source-supplied names, GTFS type, colours, text colours, version, and service validity.
- `data/route-patterns.json` contains stop-to-route references and representative ordered route patterns.

Downloaded GTFS archives and unarchived feed files remain outside version control. The checked-in JSON files are intentionally empty generated shells until a complete validated refresh runs. Publisher licences are joined by public agency identifier from the canonical feed registry and, when present, graph provenance. A missing or conflicting licence is returned as `null` with an explicit provenance state and gap record. The batch timestamp remains an exact retrieval receipt for the full validated refresh; a missing per-feed acquisition timestamp remains unavailable rather than being inferred from a file timestamp or index generation time.

Route colours are copied only from `routes.txt.route_color` and `route_text_color` when each value is a six-digit hexadecimal value. Blank or malformed publisher values remain `null`. The planner must use its neutral presentation for those values rather than inventing an agency colour.

## Stop membership

A stop receives a route only when a `stop_times.txt` record names that exact GTFS `stop_id`. A station parent also receives the union of routes serving its direct children named through `parent_station`. No route is added from coordinate proximity, a shared name, a nearby platform, a route description, or a map geometry.

Schedule versions such as `ttc` and `ttc-next` retain their own qualified identifiers. For the same public agency and raw stop identifier, the index carries the available version references together. The route catalog then selects the appropriate scheduled version for the requested calendar date through its recorded service dates and promotion boundary. This avoids hard-coding a version alias while keeping the selected stop identity stable.

`backend/places.mjs` exposes the selected official route badges as `servingRoutes` on each stop suggestion. A badge appears only when the route's declared GTFS calendar covers the selected date. A missing auxiliary pattern index produces an empty route list and does not fabricate a badge or prevent the underlying stop search from returning its source-backed result.

## Route-stop anchors

`backend/stop-routes.mjs` exports the following helper for route-aware planning features:

```js
await routeStopAnchors(routeRef, { date })
```

An exact versioned catalog route identifier, such as `ttc:1`, returns patterns from that exact version. To select a version for a date, pass a public route identity:

```js
await routeStopAnchors({ feedId: "ttc", routeId: "1" }, { date: "2026-09-06" })
```

The result is `null` for an unknown route. A known route returns the selected route badge and zero or more patterns:

```js
{
  route: { id, routeId, shortName, longName, agency, agencyId, feedId, version, color, textColor, routeType, validity },
  patterns: [{
    id,
    directionId,
    stops: [{ id, sequence, name, lat, lon }]
  }]
}
```

Each pattern is a complete source order based on `stop_sequence`. The generator keeps at most four deterministic unique representative patterns for each route version and direction identifier, which bounds output size without cutting a retained pattern short. A publisher omission of a usable stop coordinate remains `null`; no coordinate is estimated. Consumers must use only consecutive pairs from one returned pattern and must validate their own routing result after using any route-based via points.

## Bounds and failure behaviour

The generator streams `trips.txt` into a temporary SQLite lookup with bounded batched inserts and a two-mebibyte cache, then streams `stop_times.txt` by contiguous `trip_id` group. It retains only the active trip's rows plus bounded route-pattern candidates in memory. The temporary lookup is discarded after each feed. The generator rejects a file that reopens a completed trip group, because accepting it would construct a partial, invented sequence. It also bounds feed stops, routes, trips, stop times per trip, and representative patterns per direction.

The focused checks create temporary GTFS ZIP fixtures rather than committing feed data. They cover multiple routes, both directions, version aliases, missing colours, parent-child station unions, exact stop membership, full ordered sequences, batch provenance, a multi-batch trip lookup, and rejection of noncontiguous trip rows.

Run them from the project root:

```text
py -3 scripts/data/test_build_stop_index.py
npm --prefix backend test
```
