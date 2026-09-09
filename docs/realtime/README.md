# Real-time GTFS coverage

The runtime registry records the official provenance, access condition and verified endpoint for every requested agency. It treats a documented but unconfigured registered API as unavailable to the public runtime, rather than embedding a credential or substituting a third-party feed.

## Public protobuf feeds

| Agency | Vehicle positions | Trip updates | Service alerts | Official source |
| --- | --- | --- | --- | --- |
| TTC | `https://bustime.ttc.ca/gtfsrt/vehicles` | `https://bustime.ttc.ca/gtfsrt/trips` | `https://bustime.ttc.ca/gtfsrt/alerts` | [TTC GTFS-RT endpoint index](https://bustime.ttc.ca/gtfsrt/trips) |
| MiWay | `https://www.miapp.ca/GTFS_RT/Vehicle/VehiclePositions.pb` | `https://www.miapp.ca/GTFS_RT/TripUpdate/TripUpdates.pb` | `https://www.miapp.ca/gtfs_rt/Alerts/Alerts.pb` | [City developer download](https://www.mississauga.ca/miway-transit/developer-download/) |
| Burlington Transit | `https://opendata.burlington.ca/gtfs-rt/GTFS_VehiclePositions.pb` | `https://opendata.burlington.ca/gtfs-rt/GTFS_TripUpdates.pb` | `https://opendata.burlington.ca/gtfs-rt/GTFS_ServiceAlerts.pb` | [City open-data directory](https://opendata.burlington.ca/gtfs-rt/) |
| Hamilton Street Railway | `https://opendata.hamilton.ca/GTFS-RT/GTFS_VehiclePositions.pb` | `https://opendata.hamilton.ca/GTFS-RT/GTFS_TripUpdates.pb` | `https://opendata.hamilton.ca/GTFS-RT/GTFS_ServiceAlerts.pb` | [City open-data directory](https://opendata.hamilton.ca/GTFS-RT/) |
| York Region Transit | `https://rtu.york.ca/gtfsrealtime/VehiclePositions` | `https://rtu.york.ca/gtfsrealtime/TripUpdates` | `https://rtu.york.ca/gtfsrealtime/ServiceAlerts` | [York Region Transit](https://www.york.ca/transportation/york-region-transit-yrt) |

York Region Transit's realtime is published from `rtu.york.ca`, a separate host from the one that serves its timetable - which is why the schedule was loaded and current while its vehicles were absent for a time. An earlier review looked only at the timetable acquisition route, found a contact form and a licence agreement, and concluded there was no realtime URL; `rtu.york.ca` was found on a later, broader pass. Vehicle positions, trip updates and service alerts are all read from that host, and all three are now registered above.

## Registered Metrolinx feeds

GO Transit and UP Express use Metrolinx's official API. It documents vehicle-position, trip-update and alert resources for both, and requires a registered access key. The registry preserves the endpoint URLs and deliberately makes no unauthenticated request. The public runtime only changes their state after an owner supplies access through a private deployment configuration.

Metrolinx documents the API registration condition and the GTFS resource paths in its [API help](https://api.openmetrolinx.com/OpenDataAPI/Help), and publishes its data under the [Open Government Licence – Ontario – Metrolinx](https://www.metrolinx.com/en/about-us/open-data).

## Explicit coverage gaps

Brampton Transit, Durham Region Transit and Milton Transit have no verified canonical public GTFS-RT endpoint in the bounded official-source review and remain unavailable. Oakville Transit is scheduled-only because its official trip-planner page states that real-time information is not yet available. These states are deliberate and must not be replaced with guessed vendor paths, scraped consumer APIs or third-party mirrors.

## Trip updates applied in journey planning

A public or registered GTFS-RT feed existing (the table above) is a different, broader question from whether OpenTripPlanner actually applies that feed's trip updates to routing - which additionally requires the feed's published trip and stop identifiers to join the loaded static timetable. `GET /api/live-coverage` on the routing backend reports this narrower state per feed; see [docs/data/API.md](../data/API.md). As of this writing:

* **Applied** - OTP has a `stop-time-updater` configured and the identity join was verified before activation: MiWay (239 of 239 trip IDs matched), Hamilton Street Railway (182 of 182), GO Transit (150 of 150), UP Express (5 of 5), and York Region Transit (198 of 198, with every update additionally carrying `route_id`, `start_date`, and `start_time`).
* **Published, but unjoinable** - the feed is healthy and public, but its own identifiers do not join the loaded schedule, so applying it would silently corrupt scheduled routing rather than improve it: TTC (its trip and stop identifiers collide with, rather than match, the static timetable - see [docs/vehicles/trip-identifiers.md](../vehicles/trip-identifiers.md)) and Burlington Transit (0 of its 103 published trip IDs matched the static feed).
* **Shadow** - TTC's trip updates additionally run through a separate shadow trip matcher (`backend/ttc-trip-matcher.mjs`) that joins each update to a static trip by schedule and vehicle position instead of by identifier, and is measured against a published rolling-gate threshold before its rewritten output would ever be wired into routing. See "Shadow matcher (2026-09)" in [docs/vehicles/trip-identifiers.md](../vehicles/trip-identifiers.md) for the algorithm and the gate.

TTC TripUpdates remain outside OTP until the shadow matcher has collected the required evidence. The matcher rewrites only uniquely time-matched updates whose reported vehicle is fresh and within 300 metres of the corresponding scheduled stop. It publishes match statistics but does not activate a router updater itself. The activation decision requires a 24-hour record with at least 60% unique matches, no more than 2% contradicted matches, and at least 98% stop-sequence alignment. Until that record exists, TTC is `published-unjoinable`, not live routing data.

## Runtime behaviour

`realtime/aggregator.mjs` performs only bounded `GET` requests to registry entries marked `public`: an 8 second deadline, a 10 MiB response cap and a 45 second per-feed cache. It independently validates the GTFS-RT protobuf envelope by reading the official `FeedMessage` header and entity repetition, without applying agency-specific assumptions. A failed refresh retains a prior valid result as `stale`; it never presents stale data as live.

The health summary has this shape:

```json
{ "agencies": [{ "id": "miway", "name": "MiWay", "state": "live", "capabilities": {}, "lastSuccessfulFetch": "...", "timestamp": "...", "feeds": {} }] }
```

Feed states are `live`, `stale`, `unavailable`, `scheduled_only`, or `access_required`. An agency rolls up to `live`, `partial`, `stale`, `scheduled_only`, or `unavailable`.

The registry uses the exact same ordered identifiers as `data/feeds.json`. The realtime test reads that static manifest and fails on an addition, deletion, reorder or identifier mismatch. This establishes metadata compatibility only. Real-time entities do not alter OTP routing graph provenance or route results until a separate graph-version and trip-ID compatibility validation accepts them.
