# Routing backend API

Run the service from `backend/` with `node server.mjs`. It binds to loopback on port `8787` and expects OpenTripPlanner 2 at the `otpUrl` in `backend/config.json`.

* `GET /health` reports service readiness and the configured OTP URL.
* `GET /api/places?q=union` searches the local GTFS stop index. Empty queries return an empty list.
* `GET /api/coverage` reports indexed stop count and agencies.
* `GET /api/departures?stopId=<id>&timeRange=3600` reads departures from OTP's GraphQL API. It returns an explicit error when OTP is unavailable.
* `POST /api/plan` accepts `{from:{lat,lon},to:{lat,lon},date?,time?,modes?}` and returns OTP itineraries in the normalized contract consumed by the frontend.

Requests are loopback-only, JSON bodies are limited to 32 KiB, coordinates must be finite numbers, OTP calls have an 8 second deadline, and returned legs are discarded when they lack valid endpoints. No route or departure is synthesized locally.

The plan query uses OTP 2's documented `planConnection(origin, destination, dateTime, first, modes)` operation. See the [official planConnection reference](https://docs.opentripplanner.org/api/dev-2.x/graphql-gtfs/queries/planConnection). GTFS and OSM data are loaded by the OTP deployment, while `data/stops.json` provides fast offline place search.
