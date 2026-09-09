# Live journey refresh

A planned journey is a snapshot. The routing backend therefore exposes a narrow refresh endpoint for the legs already chosen by the rider. It never re-plans a journey during refresh, because a new search could replace the rider's chosen option.

`POST /api/journeys/live` accepts at most 40 legs in one JSON body. Each entry needs its `legId`; a caller may include the planned `tripId`, `serviceDate`, `fromStopId`, and `toStopId` so an expired OTP leg can fall back to that trip's published stop times.

```json
{
  "legs": [{
    "legId": "otp-leg-id",
    "tripId": "yrt:trip-123",
    "serviceDate": "20260909",
    "fromStopId": "yrt:board",
    "toStopId": "yrt:alight"
  }]
}
```

The response preserves request order and includes one `checkedAt` timestamp. A resolved leg names `source` as `leg-refetch` or `trip-stoptimes`, retains scheduled and estimated timestamps separately, and emits signed delay seconds only when OTP published them. An unresolvable leg is `{ "legId": "...", "error": "unavailable" }`. A single 15-second request deadline and a concurrency limit of eight prevent a large result set from becoming an open-ended routing load. Responses are `Cache-Control: no-store`.

`GET /api/live-coverage` states whether each static feed is `applied`, `published-unjoinable`, `shadow`, or `none`. `applied` means OTP has a configured stop-time updater. `published-unjoinable` means the publisher has realtime but its identifiers cannot safely join the loaded timetable. TTC remains in that state unless the separate shadow matcher is explicitly wired and its 24-hour evidence clears the documented threshold. See [trip identifiers](../vehicles/trip-identifiers.md).

YRT TripUpdates are configured every 30 seconds, with alerts every minute. The activation measurement found 198 of 198 current update trip IDs in the loaded YRT timetable, and every observed update carried route, start date, start time, and delay data. This is an identity measurement, not a promise that any future publisher payload will remain compatible.
