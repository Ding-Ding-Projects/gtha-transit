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

Photos are shown only from Wikimedia Commons records whose reusable licence, source page, creator credit, and direct media URL were verified through the Commons API. Every photo has an `exactVehicle` flag. It is `true` only when the Commons record identifies the same fleet number; otherwise the image is explicitly representative. A missing verified match remains `null`. CPTDB photographs with an all-rights-reserved notice are never copied or hotlinked.

Verified images currently cover representative TTC Nova Bus LFS Hybrid, TTC FLEXITY M-1, TTC New Flyer XDE60, MiWay, Burlington Transit, Hamilton Street Railway, GO Transit, and UP Express vehicles. The client should proxy and cache these allowlisted URLs rather than making visitor browsers contact the image host directly.

## Multi-agency feeds and direction assignments

The same decoder supports the public TTC, MiWay, Burlington Transit, and Hamilton Street Railway feeds. GO Transit and UP Express use the configured routing service's protected proxy; no access credential enters this module or a client response. Each vehicle carries its feed agency namespace, and every agency-specific CPTDB destination is an honest search URL when no verified record page is available.

The matcher uses a fleet-shaped public label first and otherwise falls back to a fleet-shaped vehicle identifier. This matters for UP Express, whose labels describe the destination while identifiers such as `1006` and `3004` identify the equipment. The original label remains unchanged and a separate `fleetNumber` carries the resolved display number. Verified CPTDB roster ranges provide GO Transit MP40PH-3C and MP54AC facts and UP Express Nippon Sharyo A-car and C-car facts. Other agencies remain search-only until an equally specific roster source supports their observed number.

`enrichItineraries()` joins a direction leg to a vehicle only when its agency namespace and normalized GTFS trip identifier both match a fresh vehicle-position entity exactly. It never assigns a vehicle from a route match alone. A leg without the required identifiers, a stale or unavailable feed, or no exact fresh match receives an explicit assignment state and reason instead of a guessed vehicle.

## Failure and privacy boundaries

The parser accepts at most 10 MiB and 10,000 entities, refuses redirects, applies a deadline of at most 10 seconds, validates protobuf boundaries, rejects invalid coordinates, and never logs the feed body. This feature uses public operational data and stores only the short-lived in-memory snapshot.

Sources: [TTC GTFS Realtime vehicle positions](https://bustime.ttc.ca/gtfsrt/vehicles), [TTC Service Summary, December 7, 2025](https://cdn.ttc.ca/-/media/Project/TTC/DevProto/Documents/Home/Transparency-and-accountability/Service-summary-2025-12-07.pdf?rev=ad117ec728ae47fd868aea9aaa1c3835), [City of Toronto dataset and licence](https://open.toronto.ca/dataset/ttc-bustime-real-time-next-vehicle-arrival-nvas/), and [CPTDB TTC index](https://cptdb.ca/wiki/index.php/Toronto_Transit_Commission).

Both directions and the tracker display a visible exact-vehicle or representative-photo caption. Representative images do not identify the assigned vehicle. Creator attribution links to the source record; a separate licence link opens the recorded HTTPS licence URL when available. Missing or invalid links remain plain text.

The LFS Hybrid photo uses the published 960px Wikimedia thumbnail of TTC 3539 by Dillan Payne, CC BY-SA 4.0. Source: https://commons.wikimedia.org/wiki/File:Blue_Night_TTC_Bus_3539_at_Rouge_Hill_GO_Station,_July_11_2026.jpg . The visible fleet number, embedded creator metadata and source attribution were checked together. It is exact only for 3539. A previous image was removed because its visible watermark conflicted with its source attribution; the removed URL is no longer registered by the proxy.

TTC XDE60 and HSR photo entries are currently omitted after their source creator claims conflicted with visible or embedded attribution. The former XDE60 original also exceeded the 10 MiB proxy limit. Vehicle positions and verified fleet facts remain available; replacement photo coverage is pending.

The map retains every loaded vehicle while the list uses 100-row pages. Up to four bounded API batches retrieve the supported feed parser's 10000-vehicle maximum; a remaining cursor is disclosed rather than silently presented as complete. Fleet-number ordering is stable between refreshes, criteria changes reset the page and hide the prior snapshot, and shrinking results clamp the page. Marker selection opens its details and reveals its list page. Changing agency clears the route filter; vehicles absent from a refreshed result no longer retain an old detail card.

Selecting a list row or map marker brings its detail panel into view and focuses it below the measured sticky header. Re-selecting the same vehicle repeats that action. Background position refreshes do not move focus or scroll the page.

All agencies is the default tracker view. Connected feed snapshots are combined with agency-qualified vehicle identities, preventing equal fleet numbers from colliding. Agency-coloured markers and rows retain readable agency labels and feed-status information. Map markers open an embedded summary; More details reveals and focuses the matching list detail panel.
