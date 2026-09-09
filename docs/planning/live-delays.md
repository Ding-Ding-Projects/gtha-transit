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

The 15-second deadline is also a hard ceiling in the OTP client, even if a caller supplies a larger timeout. Malformed JSON, invalid leg arrays, and impossible calendar dates such as `20260230` receive HTTP 400 before a routing request is made.

`GET /api/live-coverage` states whether each static feed is `applied`, `published-unjoinable`, `shadow`, or `none`. `applied` means OTP has a configured stop-time updater. `published-unjoinable` means the publisher has realtime but its identifiers cannot safely join the loaded timetable. TTC remains in that state unless the separate shadow matcher is explicitly wired and its 24-hour evidence clears the documented threshold. See [trip identifiers](../vehicles/trip-identifiers.md).

YRT TripUpdates are configured every 30 seconds, with alerts every minute. The activation measurement found 198 of 198 current update trip IDs in the loaded YRT timetable, and every observed update carried route, start date, start time, and delay data. This is an identity measurement, not a promise that any future publisher payload will remain compatible.

Public coverage results, including the `liveCoverage` member of `/api/plan`, contain only feed state, refresh frequency and explanatory reason. Internal updater URLs are never exported. The flattened backend image must include `/app/otp/router-config.json` and `/data/feeds.json`; HTTP runtime tests materialize the Dockerfile COPY instructions and launch the resulting server to catch missing runtime files.

Build the backend with `--build-arg SOURCE_COMMIT=<full-source-sha>` to record the exact source in its `org.opencontainers.image.revision` label and environment. `/health` includes `sourceCommit` only when this metadata is a valid full 40-character lowercase hexadecimal SHA. Missing or invalid provenance is omitted, never inferred from launch time or reported as a verified revision. Deployment verification must compare the value and image label with the intended source commit independently.

## Shadow matcher resource limits

TTC remains excluded from OTP's stop-time updaters. The shadow matcher now shares concurrent manual polls and schedules its next automatic poll only after the preceding poll finishes. All feed indexes rebuilt in one poll share limits of 2,000 GraphQL requests, 400 routes, 40,000 examined trips, 1,000,000 stop times, 500 stop times per trip, and a 45-second total index deadline. Each actual GraphQL request also has an eight-second transport deadline and a 10 MiB response limit. Only missing-schema-field errors select the compatibility fallback; a transport failure, exhausted bound or timeout does not start another strategy.

An index is installed only after its complete bounded load succeeds. Initial and stale rewritten feeds are empty protobuf messages. A last successful rewritten feed may survive a failed poll for at most 120 seconds; HTTP reads enforce that limit even while another poll is pending. These resource checks do not satisfy the match-quality activation threshold or enable TTC realtime routing.

Focused verification: `node --test backend/*.test.mjs tests/catch-vehicle-backend.test.mjs tests/ttc-trip-matcher.test.mjs tests/live-coverage-http.test.mjs`. The matcher tests exercise slow/reentrant polling, rejection recovery, primary and fallback query budgets, a deadline against an adapter that ignores abort, and empty/stale feed output. HTTP tests verify coverage privacy, collector admission and live-refresh bounds against a local OTP fixture. They do not claim deployed routing-engine or physical-device verification.
