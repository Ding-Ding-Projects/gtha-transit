# Multiple stops

`POST /api/plan` keeps the existing `from` and `to` places and accepts an optional ordered `via` array. Each `via` value is a place with finite `lat` and `lon` coordinates and an optional `name` or `label`. The service accepts zero to five intermediate places. Latitude must be from -90 through 90, longitude must be from -180 through 180, and a supplied label is limited to 200 UTF-8 bytes with no control characters.

For example, a journey that must visit two places is submitted as:

```json
{
  "from": { "lat": 43.7065, "lon": -79.3984, "name": "Eglinton Station" },
  "via": [
    { "lat": 43.6453, "lon": -79.3806, "name": "Union Station" },
    { "lat": 43.6670, "lon": -79.3994, "name": "Bloor-Yonge Station" }
  ],
  "to": { "lat": 43.7700, "lon": -79.4137, "name": "Finch Station" },
  "dateTime": "2026-09-05T09:00:00-04:00",
  "arriveBy": false,
  "preference": "waiting"
}
```

The backend sends one native OpenTripPlanner 2.9 `planConnection` query. Each selected intermediate place becomes an ordered `PlanViaLocationInput.visit` coordinate with `minimumWaitTime: "PT0S"`. A visit requires the returned trip to reach that place. This does not run separately ranked routes for each leg, so the routing engine keeps the time and transfer state across the complete ordered journey.

For departure planning the query contains only `earliestDeparture`. For arrive-by planning it contains only `latestArrival`, applied to the final destination. The offset-bearing ISO timestamp remains unchanged. OpenTripPlanner performs its native ordered routing internally, so the API never guesses an intermediate departure or arrival time in the browser or backend.

Multi-stop routing is deliberately bounded. It uses one upstream request under the existing 15-second request deadline and asks for one complete itinerary, rather than exhaustively searching every possible combination of intermediate connections. The response includes a journey only when every requested visit is confirmed in the normalized leg sequence through `viaLocationType: "VISIT"`, in the requested order, and within 100 metres of the requested coordinate. Repeated endpoint representations at a leg boundary are treated as one visit. The original stop-to-stop behavior still returns the configured set of ranked itineraries.

If no complete route is returned for an ordered list, the API returns HTTP 422 with `code: "MULTI_STOP_INCOMPLETE"`, an empty itinerary list, and no partial journey. When the response contains enough evidence to identify the first unconfirmed ordered segment, `failedSegment` names it and marks its state as `"unverified"`. That state means the router did not return a complete result through that segment, not that the API inferred a particular operational cause. A `null` value means the router supplied no safe segment-level evidence.

`preference: "waiting"` ranks returned transit journeys by the total valid platform wait between consecutive transit legs. Walking between those legs is excluded from the platform-wait total. A missing, malformed, overlapping, or negative time produces `transferWaitSeconds: null` and `transferWaitKnown: false`; it is never treated as zero. Known values rank before unknown values, while the existing arrival-direction tie-break remains in effect. If any transit option exists, walk-only options are retained after the transit options so that a short walk does not masquerade as a zero-wait transit trip. The existing `fastest`, `transfers`, and `walking` preferences retain their prior ranking behavior.

The implementation is verified with a local GraphQL fixture that checks the native `via` declaration, order, visit coordinates, `PT0S` dwell, one-date-time polarity, one-query bound, leg visit markers, incomplete-route response, and waiting-time ranking. A read-only live OTP 2.9 schema inspection confirms that `planConnection` exposes `via: [PlanViaLocationInput!]` and that each input supports `visit`.

Suggested articles: [Planning a journey](README.md), [routing API](../data/API.md), and [regional data](../data/README.md).
