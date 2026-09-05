# Live TTC vehicle positions

The server reads the TTC's official GTFS Realtime vehicle-position feed and exposes a bounded, cached snapshot for the map and a paginated query for search results. Positions are observations, not arrival predictions. A position older than 120 seconds is visibly marked stale.

## Data contract

`getVehicleSnapshot()` returns every valid position in the current feed, up to the 10,000-entity safety limit. `getVehicles({ q, route, limit, cursor })` applies server-side search and exact route filtering, returns at most 2,500 records so one request can supply the live map, and supplies an opaque next cursor when another page exists. List views should request 100 records at a time. The 15-second cache limits upstream traffic. If refresh fails after a valid response, the last snapshot remains available as stale data. With no valid snapshot, the state is `unavailable` and the vehicle list is empty.

Each vehicle includes the published identifier, label, route and trip identifiers, coordinates, bearing, speed converted from metres per second to kilometres per hour, observation time, stale state, and licence plate when TTC publishes it. Missing optional values remain `null` or an empty string rather than being invented.

## CPTDB roster matching

TTC fleet facts come from the official TTC Service Summary dated December 7, 2025, whose vehicle inventory was updated November 24, 2025. Every vehicle receives a CPTDB search URL labelled `search`; the application does not claim that an unverified unit or series page exists. Fleet facts and the CPTDB lookup are separate provenance boundaries.

The registry records only facts supported for the complete official range: manufacturer, model, build year or range, propulsion, length, and seats. A vehicle appearing in the live feed gets `observedLive: true`; that observation is not a claim that the entire series is active. The registry does not infer a model from route, vehicle shape, or nearby fleet numbers.

The registry was checked against a live TTC snapshot retrieved at `2026-09-05T00:11:50.108Z`; its feed timestamp was `2026-09-05T00:11:43.000Z`. Identifiers outside the dated official inventory remain honest search-only records rather than inheriting facts from a nearby range. This count is point-in-time evidence rather than a fixed fleet total.

## Photos and rights

`photo` is currently `null`. CPTDB vehicle photographs commonly carry photographer-specific copyright notices, including all-rights-reserved notices, so the service does not copy, hotlink, or treat an image page as permission to display the image. The CPTDB roster link remains available for research. A future photo may be shown only with a verified reusable licence, source page, credit, and an `exactVehicle` label that distinguishes a photographed unit from a representative fleet-series image.

## Failure and privacy boundaries

The parser accepts at most 10 MiB and 10,000 entities, refuses redirects, applies a deadline of at most 10 seconds, validates protobuf boundaries, rejects invalid coordinates, and never logs the feed body. This feature uses public operational data and stores only the short-lived in-memory snapshot.

Sources: [TTC GTFS Realtime vehicle positions](https://bustime.ttc.ca/gtfsrt/vehicles), [TTC Service Summary, December 7, 2025](https://cdn.ttc.ca/-/media/Project/TTC/DevProto/Documents/Home/Transparency-and-accountability/Service-summary-2025-12-07.pdf?rev=ad117ec728ae47fd868aea9aaa1c3835), [City of Toronto dataset and licence](https://open.toronto.ca/dataset/ttc-bustime-real-time-next-vehicle-arrival-nvas/), and [CPTDB TTC index](https://cptdb.ca/wiki/index.php/Toronto_Transit_Commission).
