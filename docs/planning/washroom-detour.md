# Washroom detours

The washroom planner uses only facility records with an official source receipt. It does not infer a washroom from a nearby business, a station-like name, or a road name.

## Facility matching and availability

`shared/washrooms.mjs` matches an itinerary place only when both of these are present:

- an agency-qualified identity such as a GTFS stop or station ID; and
- one unambiguous facility record with the same agency and identity.

Display names are not identities. This prevents a street or intersection called Eglinton or Finch from being presented as a TTC station, and preserves the separate TTC, GO Transit, and UP Express records in the Union complex.

The backend derives facility station identities at load time from `data/stops.json`. That file is produced by `scripts/data/build-stop-index.py` from validated official GTFS archives. The derivation requires a source-receipted facility, its exact official station or terminal alias, a matching public agency, a qualified stop ID, and a GTFS station entry (`locationType: 1`). It can accept both current TTC feeds, including `ttc-next`, but it never derives an identity from a user-entered place name, a road stop, or coordinate proximity. The cached `washroomIdentityMap()` export is available for the selected-places API adapter to expose these verified mappings.

`facilityAvailability(facility, at)` returns one of `confirmed-open`, `closed`, or `unknown`. It evaluates official weekly intervals, cross-midnight intervals, named time zones, and dated exceptions. A missing, malformed, unsupported, or unavailable schedule is `unknown`, never an open claim.

Each leg endpoint and intermediate stop can carry `washroom` metadata. Preference ranking treats a source-confirmed transit station or terminal as useful unless published hours say it is closed. An unknown transit schedule remains explicitly `unknown` and is never presented as open. Municipal facilities such as libraries require `confirmed-open` hours before they can improve an itinerary. Metadata for an intermediate pass-through stop is preserved for display but cannot improve an itinerary's ranking.

The official source receipts, facility identifiers, and conservative hours records are documented in [washroom sources](washroom-sources.md).

## Detour planning contract

`planWashroomDetour(input, dependencies)` is a backend-only, dependency-injected operation. The runtime adapter supplies the real OpenTripPlanner function as `dependencies.planWithOtp` and the facility registry as `dependencies.facilityRegistry`.

The required input has these fields:

```json
{
  "currentPosition": { "lat": 43.64, "lon": -79.39 },
  "to": { "lat": 43.70, "lon": -79.35 },
  "via": [{ "lat": 43.68, "lon": -79.37 }],
  "dateTime": "2026-09-07T12:00:00-04:00",
  "preference": "fastest",
  "wheelchair": false,
  "maxWalkDistance": 2000
}
```

`currentPosition` must be an explicit coordinate, or an exact agency-qualified stop identity that resolves uniquely through the local stop index. The operation never falls back to a display name or an earlier trip origin. A facility route uses either published facility coordinates or a unique explicit GTFS identity. It never geocodes a facility name.

The operation sorts verified-coordinate candidates by straight-line distance, considers at most six, and routes at most two candidates concurrently. It sets a total deadline below 25 seconds. For each candidate it first routes to the facility, checks that the facility is `confirmed-open` at the expected arrival, then plans the remaining journey using the original `to` and ordered `via` list.

`completeJourney: true` is returned only when both legs resolve. A facility leg can be useful even when the remaining trip is unavailable, so that state is returned honestly:

```json
{
  "status": "partial",
  "completeJourney": false,
  "facility": { "facilityId": "example", "availability": "confirmed-open" },
  "facilityLeg": {
    "timeToFacilitySeconds": 420,
    "internalWalkingUnknown": true
  },
  "continuation": null,
  "unresolved": {
    "code": "CONTINUATION_UNRESOLVED",
    "preservedTo": { "lat": 43.70, "lon": -79.35 },
    "preservedVia": [{ "lat": 43.68, "lon": -79.37 }]
  }
}
```

`internalWalkingUnknown` means the transit result reaches the facility coordinate but does not claim a distance, route, accessibility condition, or access time inside the building.

Municipal facilities without official routing coordinates remain explicit `FACILITY_COORDINATES_UNAVAILABLE` results. They are never assigned guessed coordinates. A station can also use a uniquely matched, agency-qualified GTFS stop from the local stop index when its facility record carries official identity source evidence. Facilities with unknown hours are not automatic urgent-detour candidates.

## Verification

Focused backend tests cover weekly and cross-midnight hours, daylight-saving time, dated exceptions, unknown availability, agency-qualified Union identity, road-name rejection, missing current coordinates, missing facility coordinates, candidate-pool and concurrency bounds, continuation failure, and preservation of ordered remaining destinations.
