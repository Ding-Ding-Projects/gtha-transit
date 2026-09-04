# Routing backend API

Run the service with `docker compose -f backend/compose.yaml up -d --build`. The public API listens on port `8787`; OpenTripPlanner stays on the private Compose network.

* `GET /health` reports API process readiness.
* `GET /api/places?q=union` searches the local GTFS stop index. Empty queries return an empty list.
* `GET /api/coverage` reports every validated feed, its service calendar, digest, byte size, loaded state, and indexed stop count.
* `GET /api/departures?stopId=<feed:stop>&timeRange=3600` reads scheduled departures. Arrival and departure values are Unix epoch seconds computed from OTP's `serviceDay` plus the scheduled offset.
* `POST /api/plan` accepts `{from:{lat,lon},to:{lat,lon},dateTime:"2026-09-05T08:00:00-04:00",arriveBy:false,wheelchair:false,maxWalkDistance:2000,preference:"fastest"}`. Preference may be `fastest`, `transfers`, or `walking`.

JSON bodies are limited to 32 KiB, coordinates must be finite numbers, OTP calls have a 15 second deadline, and returned legs are discarded when they lack valid endpoints. Upstream failures return one bounded public message without internal URLs or raw upstream details. No route or departure is synthesized locally.

The plan query uses OTP 2's documented `planConnection(origin, destination, dateTime, first, modes, preferences)` operation. Each leg includes string route and agency names, duration in seconds, and encoded polyline geometry. See the [official planConnection reference](https://docs.opentripplanner.org/api/dev-2.x/graphql-gtfs/queries/planConnection). GTFS and OpenStreetMap data are loaded by the OTP deployment, while the generated `data/stops.json` provides fast offline stop search.
