# Live delays and status

Once a journey is planned, each transit leg and the journey as a whole carry a small
live-status chip instead of a flat "scheduled" badge: an icon, a word, and (only when
it differs from the timetable) the scheduled time struck through beside the live one.
Colour never carries the meaning alone.

Nothing here is guessed. Every classification traces back to something the routing
backend or the live-coverage endpoint actually published: a signed delay, a realtime
status word, or a feed's own admission that it cannot join its updates to the loaded
timetable. A leg the backend cannot vouch for reads as "timetable only" or "not
matched", never as an invented on-time.

## States

| State | Meaning | Chip role |
| --- | --- | --- |
| Early | The live estimate runs 1 minute or more ahead of the timetable. | `--gt-status-early-*` |
| On time | Anywhere from just under 1 minute early to just under 3 minutes late. | `--gt-status-on-time-*` |
| Late | 3 minutes or more behind the timetable. | `--gt-status-late-*` |
| Late (severe) | 5 minutes or more behind the timetable -- the same `late` state, a distinct visual tier. | `--gt-status-very-late-*` |
| Cancelled | The publisher marked this trip `CANCELED`. | the existing error role |
| Timetable only | This leg's agency has no live trip updates reaching journey plans at all. | neutral surface |
| Live data not matched | The agency has live coverage, but this specific leg was not matched to a live update. | neutral surface |
| Live data is stale | The last live check for this leg is older than the staleness threshold. | neutral surface, dashed border |
| No time information | Neither a scheduled nor an estimated time was published (or the leg is a walk). | neutral surface |

The classifier lives in `lib/live-status.ts`: `classifyLeg` decides one transit leg's
boarding or alighting state, `classifyStop` does the same for one stop in the
"upcoming stops" list a live follower shows, and `summariseJourney` rolls a set of leg
statuses up into one state for the whole journey (a single cancelled leg outranks a
merely late one, because that is what cancels the trip in a rider's eyes).

## Thresholds

- **Early**: `EARLY_MAX_SECONDS` is `-60` -- a full minute or more ahead of the
  timetable. Anything less is ordinary GPS and dwell-time noise, not a genuinely
  early trip.
- **On time**: anywhere from just under a minute early to just under 3 minutes late.
- **Late**: `LATE_MIN_SECONDS` is `180` -- three minutes is where a rider waiting at a
  stop actually starts to notice and adjust for it.
- **Late (severe / red)**: `VERY_LATE_MIN_SECONDS` is `300` -- five minutes is late
  enough to change what a rider does next (catch an earlier connection, start
  walking), so it gets its own, worse visual tier rather than reading identically to
  a three-minute delay.
- **Stale**: `STALE_AFTER_MS` is `120000` (2 minutes). A live check older than that
  stops being shown as its own early/on-time/late state and becomes `stale` instead,
  because a delay figure that old might no longer be true.

## Colours

The four delay-severity roles (`early`, `on-time`, `late`, `very-late`) are generated
by `scripts/design/build-material-theme.mjs` through the exact same OKLCH tone path
as every other role in the theme (`toneOf`), at a bare hue with no source swatch
behind it: early is blue (hue 250), on time is green (hue 145), late is amber (hue
75), very late is red (hue 25). `cancelled` is not a hue of its own -- it aliases the
existing `--md-sys-color-error-container` / `-on-error-container` roles outright,
because "cancelled" already means what "error" means everywhere else in this theme.

Light mode reads the light-container / dark-text pairing every other container role
already uses; dark mode swaps which tone is the container and which is the text,
exactly as dark mode swaps it for every other role. Both directions of both pairs are
checked against the WCAG 4.5:1 minimum text contrast in
`tests/material-theme.test.mjs`, alongside a hand-written list confirming all four
roles (plus the cancelled alias) actually exist in both themes -- a rule that only
checked "every role present is well-formed" would pass on a theme that never grew
these roles at all.

## Per-agency coverage

`GET /api/live-coverage` (`backend/live-coverage.mjs`) reports, per GTFS feed, whether
its trip updates are actually reaching journey plans:

| Agency | Feed id | State | Why |
| --- | --- | --- | --- |
| GO Transit | `go` | applied | Configured as a `stop-time-updater` in `backend/otp/router-config.json`. |
| UP Express | `up` | applied | Same. |
| YRT/Viva | `yrt` | applied | Same. |
| MiWay | `miway` | applied | Same. |
| Hamilton Street Railway (HSR) | `hsr` | applied | Same. |
| TTC | `ttc`, `ttc-next` | shadow, or published-unjoinable | See below. |
| Burlington Transit | `burlington` | published-unjoinable | 0 of 103 trip identifiers matched the loaded timetable. |
| Brampton Transit, Durham Region Transit, Oakville Transit, Milton Transit | `brampton`, `drt`, `oakville`, `milton` | none | No live trip-update feed is wired into the router for these agencies at all; every leg on them reads as timetable-only. |

TTC's own trip updates carry trip and stop identifiers that do not join the loaded
static timetable at all (see
[trip identifiers](../vehicles/trip-identifiers.md) for the measured mismatch rate).
By default that makes TTC `published-unjoinable`, the same as Burlington. When a
separate vehicle-identity matching service is configured (the `TTC_MATCHER_URL`
environment variable), TTC is promoted to `shadow` instead: something is attempting
to join its feed safely by vehicle position rather than by identifier, which is a
narrower and more honest claim than "applied" until that matching has itself cleared
its own verification.

`applied` is a feed-level fact, not a promise about any one rider's departure.
`classifyLeg` and `classifyStop` only report `early` / `on-time` / `late` /
`cancelled` for a leg or stop the backend actually matched to a live update
(`leg.realtime === true`, or a `realtimeState` other than `SCHEDULED`); a leg on an
applied feed that OTP could not match to a specific live update reads as
`live-unmatched`, never a guessed on-time.

## The 30-second poll

`useLiveJourneys` (`lib/use-live-journeys.ts`) keeps a planned itinerary's legs
current after the plan response itself has gone stale:

- It polls `POST /api/journeys/live` every 30 seconds, for every transit leg that
  starts within the next 3 hours and ended less than 30 minutes ago (up to 40 legs
  per request, oldest-first across the visible journeys).
- It only polls while the browser tab is actually visible
  (`document.visibilityState === 'visible'`); a backgrounded tab stops immediately
  and the next `visibilitychange` back to visible triggers an immediate refresh
  rather than waiting out the rest of a 30-second interval.
- A failed request backs off through 30s, 60s, then 120s, and resets to 30 seconds
  the moment a request succeeds again.
- `mergeLiveIntoJourneys` applies a polled response onto the planned itineraries
  without mutating them: a journey with no live update for any of its legs comes back
  as the exact same object reference, so a renderer that only re-renders on a changed
  itinerary does not re-render every unaffected card on every poll.

Every `POST /api/plan` response already carries a `liveCoverage` snapshot (from
`GET /api/live-coverage`, cached 60 seconds by the web server so a poll of
`/api/realtime` does not also re-fetch router configuration that has not changed) so
the first render never has to wait on a second round trip. `GET /api/live-coverage`
is fetched directly as a fallback before any plan has run.

## The delay-string parsing fix

Two related fixes landed alongside the chip itself:

- `legStops` (`lib/upcoming-stops.ts`) used to label a leg's own boarding and
  alighting instant `'scheduled'` unconditionally, so a departure running four
  minutes late still read as "timetable" wherever its own times were shown. It now
  reads `'estimated'` only when the leg is genuinely marked live (`leg.realtime`)
  *and* its live instant actually differs from what was scheduled; an on-time live
  leg and an unmarked leg both still read as the timetable, which is what they are.
- OpenTripPlanner serialises a delay as an ISO-8601 duration (for example `PT-1M-30S`
  or `PT13S`), not a plain number of seconds. `signedDurationSeconds`
  (`lib/live-status.ts`) parses a finite number, a numeric string, or that ISO-8601
  duration form, and returns `null` -- never a guessed zero -- for anything else,
  including a well-formed but empty duration such as bare `"P"` or `"PT"`.

## Honest limits

- **TTC subway and light rail publish no vehicle-level live data at all.** The TTC's
  public realtime feed (`bustime.ttc.ca`) is a surface-bus feed; this project reports
  its trip updates as one TTC bucket (`shadow` / `published-unjoinable`) rather than
  claiming coverage a rider on Line 1, 2, 4 or 5 does not actually have.
- Feed-level `applied` is not proof a specific departure has live data -- see
  per-agency coverage above.
- A live check older than 2 minutes is shown as `stale` rather than silently kept;
  see Thresholds above.

Suggested articles: [planning a journey](README.md), [live following](live-follower.md),
[trip identifiers](../vehicles/trip-identifiers.md), [live agency coverage](../realtime/README.md).
