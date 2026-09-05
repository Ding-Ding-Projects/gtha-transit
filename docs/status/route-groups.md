# TTC disruption route groups

The status page groups active TTC route alerts into rapid transit, streetcar, bus, network-wide, and unknown sections. Group membership is based on mode metadata published by the TTC or on the official local GTFS route catalog. It never infers a mode from a route number or from an alert's wording.

`status/ttc.mjs` adds two bounded fields to each alert without changing its identifier or existing fields:

```ts
routeIds: string[]
routeRefs: Array<{ routeId?: string; routeType?: string | number }>
routeScope: 'routes' | 'network' | 'unknown'
```

`routeRefs` retains the source's route association and source mode when one exists. `routeScope` distinguishes a route-scoped alert, an explicit network scope, and an unclassified scope. TTC's website alert endpoint supplies a text route type such as `Bus` or `Streetcar`. The GTFS-Realtime fallback supplies the optional `EntitySelector.route_type` integer when present. The website parser accepts comma- and pipe-separated route identifiers because both forms occur in publisher responses.

The client passes active alerts and the official TTC rows from `GET /api/routes` to `groupTtcDisruptions()`. The helper recognizes current rapid-transit identities before generic route-type values: Lines 1, 2, and 4 are subway, while Lines 5 and 6 are light rail. This prevents Line 5 from being placed in the streetcar section when a generic GTFS type is shared. GTFS type 3 maps to bus. A scoped current TTC type 0 maps to streetcar after the rapid-line check. A bare type 0 without a route identifier remains unknown because that generic type also covers light rail. A numeric GTFS-Realtime route type is direct mode metadata. A TTC website text label is a fallback only: when it conflicts with a matching official catalog row, the catalog wins.

For GTFS-Realtime, only an agency-only selector with no route, route type, trip, stop, or direction restriction is network-wide. A stop-only, trip-only, direction-restricted, or empty selector stays unknown until the source supplies a safe route association. Website alerts with an empty route and no route type retain the publisher's network-wide scope. An alert with an unrecognized mode, or a route absent from both its source metadata and the official catalog, remains unknown. This keeps elevator, escalator, and other non-service route-alert payloads visible without claiming a vehicle mode that the source did not establish.

An alert may legitimately affect more than one group. For example, a publisher alert associated with both a bus route and a streetcar route appears in both sections. Each section de-duplicates by alert identifier, and the aggregate count de-duplicates across all groups, so one alert is not reported as two separate disruptions.

Sources: [TTC route alerts](https://www.ttc.ca/ttcapi/routedetail/getallroutesandstopsalerts), [TTC GTFS-Realtime alerts](https://bustime.ttc.ca/gtfsrt/alerts), and the local API's official GTFS route catalog at `GET /api/routes`.
