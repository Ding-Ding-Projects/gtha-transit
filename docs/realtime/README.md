# Real-time GTFS coverage

The runtime registry records the official provenance, access condition and verified endpoint for every requested agency. It treats a documented but unconfigured registered API as unavailable to the public runtime, rather than embedding a credential or substituting a third-party feed.

## Public protobuf feeds

| Agency | Vehicle positions | Trip updates | Service alerts | Official source |
| --- | --- | --- | --- | --- |
| TTC | `https://bustime.ttc.ca/gtfsrt/vehicles` | `https://bustime.ttc.ca/gtfsrt/trips` | `https://bustime.ttc.ca/gtfsrt/alerts` | [TTC GTFS-RT endpoint index](https://bustime.ttc.ca/gtfsrt/trips) |
| MiWay | `https://www.miapp.ca/GTFS_RT/Vehicle/VehiclePositions.pb` | `https://www.miapp.ca/GTFS_RT/TripUpdate/TripUpdates.pb` | `https://www.miapp.ca/gtfs_rt/Alerts/Alerts.pb` | [City developer download](https://www.mississauga.ca/miway-transit/developer-download/) |
| Burlington Transit | `https://opendata.burlington.ca/gtfs-rt/GTFS_VehiclePositions.pb` | `https://opendata.burlington.ca/gtfs-rt/GTFS_TripUpdates.pb` | `https://opendata.burlington.ca/gtfs-rt/GTFS_ServiceAlerts.pb` | [City open-data directory](https://opendata.burlington.ca/gtfs-rt/) |
| Hamilton Street Railway | `https://opendata.hamilton.ca/GTFS-RT/GTFS_VehiclePositions.pb` | `https://opendata.hamilton.ca/GTFS-RT/GTFS_TripUpdates.pb` | `https://opendata.hamilton.ca/GTFS-RT/GTFS_ServiceAlerts.pb` | [City open-data directory](https://opendata.hamilton.ca/GTFS-RT/) |

## Registered Metrolinx feeds

GO Transit and UP Express use Metrolinx's official API. It documents vehicle-position, trip-update and alert resources for both, and requires a registered access key. The registry preserves the endpoint URLs and deliberately makes no unauthenticated request. The public runtime only changes their state after an owner supplies access through a private deployment configuration.

Metrolinx documents the API registration condition and the GTFS resource paths in its [API help](https://api.openmetrolinx.com/OpenDataAPI/Help), and publishes its data under the [Open Government Licence – Ontario – Metrolinx](https://www.metrolinx.com/en/about-us/open-data).

## Explicit coverage gaps

Brampton Transit, Durham Region Transit and Milton Transit have no verified canonical public GTFS-RT endpoint in the bounded official-source review. York Region Transit exposes its GTFS acquisition through a contact form and licence agreement, but the official route does not publish GTFS-RT URLs. These agencies remain unavailable. Oakville Transit is scheduled-only because its official trip-planner page states that real-time information is not yet available. These states are deliberate and must not be replaced with guessed vendor paths, scraped consumer APIs or third-party mirrors.

## Runtime behaviour

`realtime/aggregator.mjs` performs only bounded `GET` requests to registry entries marked `public`: an 8 second deadline, a 10 MiB response cap and a 45 second per-feed cache. It independently validates the GTFS-RT protobuf envelope by reading the official `FeedMessage` header and entity repetition, without applying agency-specific assumptions. A failed refresh retains a prior valid result as `stale`; it never presents stale data as live.

The health summary has this shape:

```json
{ "agencies": [{ "id": "miway", "name": "MiWay", "state": "live", "capabilities": {}, "lastSuccessfulFetch": "...", "timestamp": "...", "feeds": {} }] }
```

Feed states are `live`, `stale`, `unavailable`, `scheduled_only`, or `access_required`. An agency rolls up to `live`, `partial`, `stale`, `scheduled_only`, or `unavailable`.

The registry uses the exact same ordered identifiers as `data/feeds.json`. The realtime test reads that static manifest and fails on an addition, deletion, reorder or identifier mismatch. This establishes metadata compatibility only. Real-time entities do not alter OTP routing graph provenance or route results until a separate graph-version and trip-ID compatibility validation accepts them.
