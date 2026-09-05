# Required line planning

Required line planning gives a traveller a bounded way to ask for an itinerary that actually includes one selected transit route. It is designed for requests such as riding TTC Line 5, while using the same route selector for every agency represented by the official route catalog.

## Request contract

Add `requiredRoute` to the existing whole-journey planning request:

```json
{
  "from": { "lat": 43.7000, "lon": -79.4000 },
  "to": { "lat": 43.8000, "lon": -79.3000 },
  "dateTime": "2026-09-05T09:00:00-04:00",
  "via": [],
  "requiredRoute": {
    "feedId": "ttc",
    "routeId": "5",
    "routeRef": "5"
  }
}
```

`feedId` and `routeId` are both required whenever `requiredRoute` is supplied. Route numbers are not globally unique, so a bare `"5"` never inherits TTC identity. If `requiredRoute` is omitted entirely, the helper uses TTC route `5` as its default. `routeRef` is optional display metadata and is never used to prove that the selected line was ridden.

The public `/api/plan` endpoint accepts this object. Without it, ordinary planning does not add a required route. Journey preferences provide a Line 5 shortcut and an agency-first route picker with an independent search workbench. The picker uses the selected Toronto date; saved trips and shared links retain the selected route. An unresolved bounded search returns no partial itinerary and does not imply that the route has no service.

## Verification rule

An itinerary is returned only when one of its normalized transit legs has the exact selected public feed and GTFS route identifier. The matcher accepts transit modes `BUS`, `RAIL`, `SUBWAY`, and `TRAM`. It normalizes the documented TTC feed-version alias `ttc-next` to `ttc`, and removes a route-id namespace only when that namespace identifies the same feed.

The matcher refuses a walking leg, a station visit, a route display label, a trip-id substring, an absent agency feed identity, an absent GTFS route identifier, route `50` for a request for route `5`, and another agency's route `5`. Passing near a station or requesting a path through two stops therefore does not prove that the passenger rode the selected line.

## Bounded detour search

The helper first sends the original whole journey to the injected routing planner, including the selected route object. It accepts that result only after independently checking its returned legs. A planner may use the object as a native preference when it supports that capability. Until that capability is wired, the native call is only a verified probe and cannot claim that the routing engine honored a preference.

The current OTP GTFS `planConnection` client does not yet expose a safe preferred-route control. It intentionally does not use a transit include filter, because that filter applies to each transit trip and could remove the bus, rail, or subway connector needed to reach the selected line. A higher walking reluctance can influence routing but cannot prove use of the selected route, so it is not treated as verification. The future planner seam must preserve all connector transit and still validate the returned normalized route identifier.

If the native result does not contain the selected line, the helper asks the official stop-pattern index for the selected route on the routing graph's Toronto service date. It uses only source-provided route patterns, stop identities, source ordering, and stop coordinates. It does not invent stops, schedules, track geometry, or a line shape.

For each official directional pattern and each legal waypoint gap, it chooses one nearest eligible **consecutive** source edge. The board stop is `pattern.stops[i]` and the alight stop is `pattern.stops[i + 1]` from the same direction and pattern. Source stop order is preserved, and no pair is assembled from separated stops or different patterns. The original origin, destination, and every requested `via` remain in their original order. Exactly one official board and alight pair is inserted into one gap, then the whole journey is planned again. The helper never chains independent partial journeys.

At most four unique, valid detour candidates are sent after the one native attempt. Source expansion accepts at most four patterns and 512 stops per pattern before choosing candidates. Invalid coordinates, invalid sequence order, identical board and alight stops, incompatible namespaced stop feeds, or missing direction data are excluded. The response envelope must exactly match the selected route. If a future pattern record also declares a feed or route identifier, that declaration must match too. The current pattern schema scopes each pattern through its validated response envelope and does not carry a separate route identifier.

The helper runs at most two detour requests at once, shares a 24-second deadline across native lookup, official anchor lookup, bounded source expansion, and detours, and passes a remaining per-request limit no higher than 15 seconds. A request timeout stops further candidate dispatch, so an abort-ignoring request cannot create a third concurrent operation. A verified result from one completed candidate is retained even when another candidate later times out.

The current ordered-via planner accepts at most five intermediate places. If retaining all requested stops plus a required board and alight pair would exceed that limit, the helper returns `REQUIRED_ROUTE_VIA_CAPACITY_UNAVAILABLE`. It does not drop, reorder, or silently replace a requested stop.

## Result contract

Every result has the original `itineraries` field and this decision metadata:

```json
{
  "requiredLine": {
    "route": { "feedId": "ttc", "routeId": "5", "routeRef": "5" },
    "status": "satisfied",
    "strategy": "native",
    "reason": null,
    "attemptedCandidates": 0,
    "completedCandidates": 0,
    "failedCandidates": 0,
    "truncated": false,
    "estimate": {
      "baselineDurationSeconds": 1200,
      "selectedDurationSeconds": 1500,
      "extraDurationSeconds": 300
    }
  }
}
```

`estimate` compares the selected result with the best native result when both reported a valid duration. It is an estimate from returned routing data, not a promise of a service time. A negative `extraDurationSeconds` means the selected route happened to be faster than the available baseline.

`strategy` is `native`, `anchor-detour`, or `none`. The helper returns only verified selected-line itineraries. It de-duplicates equivalent journeys and orders candidate results deterministically after concurrent calls complete.

## Honest unavailable states

The helper does not claim that a selected route is impossible. Its bounded reason code describes what the available official data and routing attempts established:

| Code | Meaning |
| --- | --- |
| `INVALID_REQUIRED_ROUTE` | The supplied route lacks a valid feed or GTFS route identifier. |
| `REQUIRED_ROUTE_ANCHORS_UNAVAILABLE` | The dated official route index has no usable source-backed directional stop pattern. The selected line may be closed, absent from the loaded data, or unavailable for the requested date. |
| `REQUIRED_ROUTE_VIA_CAPACITY_UNAVAILABLE` | Preserving all requested intermediate stops would exceed the routing engine's supported via capacity once an official board and alight pair is added. |
| `REQUIRED_ROUTE_SEARCH_TIMEOUT` | The shared bounded search deadline or a request budget elapsed before an unverified search could complete. |
| `REQUIRED_ROUTE_UPSTREAM_UNAVAILABLE` | Every dispatched routing request failed before returning a journey. |
| `REQUIRED_ROUTE_SEARCH_INCOMPLETE` | The native probe or at least one detour request failed and no verified selected-line journey was returned. |
| `REQUIRED_ROUTE_NOT_FOUND_WITHIN_BOUNDS` | The completed bounded candidates did not return a journey containing the selected line. This is not a global impossibility claim. |

`truncated: true` means candidate or source-pattern work exceeded the bounded search limits. It is a limit disclosure, not evidence that no journey exists.

## Verification

Focused fixture tests cover native exact matching, TTC feed-version normalization, cross-agency route identity, false positives, official-pattern validation, ordered waypoint preservation, candidate caps, two-request concurrency, deadline aborts, duplicate-result suppression, and every unavailable state. The fixtures do not invent production stops, schedules, or line geometry. A separate routing-engine integration check is required before an HTTP surface states that a required-line journey is available.
