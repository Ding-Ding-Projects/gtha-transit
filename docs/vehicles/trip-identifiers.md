# Identifying the vehicle on a leg

A journey leg shows a vehicle only when the published data actually identifies one. There are two ways it can, and the interface always says which was used.

## Why an exact trip identifier is not enough for the TTC

Measured against the live feeds on 6 September 2026: of **406** trip identifiers published in the TTC realtime vehicle feed, **104** also existed in the loaded static timetable, but only **one** of those carried the same route.

The realtime identifier space is therefore not the static one. An identifier that appears in both is almost always a number collision between unrelated trips, which means an identifier match on its own can name a bus from a completely different route. The exact join now requires the route to match as well, so a collision assigns nothing.

## The stop identifiers do not join either

The same check on stop identifiers is worse. Of the **192** live TTC vehicles whose reported stop identifier also existed in the loaded timetable, **not one** was within 300 metres of that timetable's stop. Distances ran to tens of kilometres: a vehicle reporting stop `1110` sat 23 km from the stop the timetable calls `1110`.

So a stop-identifier match is a number collision too, and a join built on it would name the wrong vehicle rather than none. The position join therefore compares **published coordinates**, which cannot collide by numbering.

## The position join

When no exact identifier matches, a vehicle is identified only if all of the following hold at once:

- it is on the leg's own route, compared on the feed-qualified route identity;
- its published position is within 150 metres of the stop **where this trip should be right now**, measured as a great-circle distance between the two published coordinates. The expected stop comes from the publisher's own stop times: the stop nearest the current moment, and one either side of it to allow for a bus in motion;
- the observation falls inside the leg's own window, from twenty minutes before boarding to five minutes after arrival;
- its position is fresh, not stale.

If exactly one vehicle satisfies all of that, it is shown with a visible note explaining that it was identified by position rather than by trip identifier. If more than one does, the leg reports that several vehicles qualify and names none. **Route equality alone never assigns a vehicle.**

## Why the expected position, and not any stop on the leg

A long bus leg passes dozens of stops. Asking whether a vehicle is near **any** of them matched most of the route's fleet at once: a route 68 leg with 42 intermediate stops reported that several vehicles qualified and named none, which is no more useful than finding nothing. The stop times now available for every intermediate stop place the trip precisely, so the question became whether a vehicle is where this trip should be - which is the vehicle the rider will actually board.

## Before a departure has started

A tracker normally carries a vehicle from its previous trip into the next one, because its realtime feed and its timetable share trip or block identifiers. This operator's do not - measured above - so that chain cannot be built from published data and is not pretended here.

What is offered instead is a measured fact: the **closest vehicle on this route to your boarding stop**, with its distance. It is labelled as exactly that. It is not called the assigned vehicle, because nothing published ties a vehicle to a departure, and a vehicle more than 25 km away is not described as approaching at all.

## What is not claimed

A position match is titled **Vehicle seen on this leg**, not *Currently assigned vehicle*, because that is all it establishes. On a corridor with departures a few minutes apart, the same observed vehicle can satisfy more than one departure at once: the operator publishes nothing tying a vehicle to a particular departure, so the interface reports what was seen rather than inventing an allocation. A position match is evidence, not a booking. It says the operator reported one vehicle of that route at a stop on this leg while the leg was running; it does not prove that vehicle will carry any particular passenger, and a service change after the observation is not reflected. A leg that has already finished, or is more than two hours away, keeps its existing unavailable verdict rather than borrowing a current observation.

## Shadow matcher (2026-09)

The position join above answers "which vehicle is on this leg" for a rider looking at one journey. A second, separate problem is upstream of that: OpenTripPlanner's own routing only applies a live TripUpdate to a scheduled trip when the update's own identifiers join the loaded static timetable, and TTC's do not (measured above). `backend/ttc-trip-matcher.mjs` is a shadow trip matcher built to close that gap for TTC specifically: it runs continuously against the live feed, joins each update to a static trip by a method other than identifier matching, and rewrites matched updates onto static identifiers OTP can actually apply - but its output is not wired into routing until it has been measured against a published pass/fail gate. "Shadow" names exactly that state: running and measured, not yet trusted.

### Why stop identifiers still cannot be trusted, even here

A second measurement, independent of the one above: for a sample of live TTC TripUpdates, only about **0.5%** of the time does an update's reported `stop_id` also appear as a stop on the *same static route* the update itself claims to be on. That is close enough to the rate a random collision would produce that stop-id text alone is not usable evidence, even scoped to the right route. The matcher accordingly never compares stop ids to decide a match; it uses them only afterward, to label the stops of a trip it has already identified by other means.

### The algorithm

For each live TripUpdate, the matcher:

1. Looks up the static trips running on the update's route (`route_id`, the only routing identifier TTC's feed reliably publishes).
2. Confirms the update's first `stop_sequence`, after an operator-configured `SEQUENCE_OFFSET`, exists on at least one of those trips at all. If it exists on none of them, the mismatch is systemic rather than a matter of timing, and the update is classified `sequence-misaligned` before any schedule comparison runs. `SEQUENCE_OFFSET` defaults to zero (no shift); a live feed whose `stop_sequence` numbering starts from a different base than the static feed's `stop_sequence` would show up as a high `sequence-misaligned` share in the match-rate statistics below, which is the operational signal to measure and set that offset.
3. Filters to trips whose schedule places that same stop within **60 minutes** of the update's predicted time (`matchWindowS`, an initial, deliberately generous filter - not the uniqueness test).
4. Scores every trip that survives that filter by the mean absolute difference between predicted and scheduled time over up to the first three stop-time updates the live update and that trip's schedule both cover, and separately keeps the mean *signed* difference (the trip's apparent running-early/late offset).
5. Accepts the best-scoring trip only when its score is at most **300 seconds** and it beats the runner-up (if any) by at least a further **300 seconds** (the uniqueness margin); short of that, the update is `ambiguous`. A route with no trip surviving the 60-minute filter at all is `none`.
6. For a unique score, looks up the update's own `vehicle.id` among recently decoded VehiclePositions. No fresh (published within 120 seconds) position for that vehicle is `unverified` - the score is unique, but nothing confirms it. A fresh position more than **300 metres** from the matched trip's delay-adjusted expected position right now is `contradicted`.
7. Only a fresh, position-consistent, uniquely-scored match is classified `unique`, and only a `unique` match is rewritten: its trip and route identifiers are replaced with the static schedule's own (feed-prefix stripped), and every one of its stop-time updates - not only the three sampled for scoring - is remapped onto the matched trip's static stop ids.

Measured against a sample of 500 live TripUpdates, running the time side of this algorithm alone (steps 1-5, before any vehicle-position confirmation) classified **104 as unique, 370 as ambiguous, and 26 as none** at the ±60 minute window and 5-minute (300 second) margin above. That both matches the intuition the identifier study above already established (TTC's schedule is dense enough that a time-only match is rarely unambiguous) and explains why step 6 exists at all: a time-only match on its own is right too rarely to route on. Separately, **99% of live TripUpdates carry a `vehicle.id`**, so step 6's position confirmation is actually reachable for nearly every update that scores as unique - it is rarely `unverified` for lack of a vehicle id to look up in the first place.

### The emitted contract

Running directly (`node backend/ttc-trip-matcher.mjs`, as the `ttc-matcher` Compose service does) polls the live feed every 30 seconds and serves three routes on its own port (8790 by default, `TTC_MATCHER_PORT`): `GET /health` (fails once the last successful poll is more than three poll intervals old), `GET /internal/ttc/trips` (a GTFS-Realtime `FeedMessage`, re-encoded by this module's own codec, containing only the current poll's `unique` updates rewritten onto static ids - `ttc`/`ttc-next`'s prospective `stop-time-updater` source), and `GET /internal/ttc/match-stats` (the latest poll's counters, a rolling 24-hour sum, and that sum's gate verdict). A poll that fails to fetch or decode the live feed, or a static-schedule reload failure, holds the last-known-good rewritten feed for up to 120 seconds before falling back to an empty one, rather than serving a stale trip onto a now-wrong static id. Importing the module (as its test suite does) never starts the poll loop or the HTTP server; only executing it directly does.

### The gate

`gateVerdict()` reports whether a batch's (or the rolling 24-hour window's) counters clear all three published thresholds at once: at least **60%** of updates classified `unique`, at most **2%** `contradicted`, and at least **98%** *not* `sequence-misaligned` (an "alignment" ratio). All three are inclusive of their boundary and all three must hold; a window with no updates at all never passes. These are deliberately conservative: `unique` is already the output of the 300-second score cap and margin above, so the gate is asking for that already-strict classification to be the common case, contradictions to be rare, and the sequence numbering to be right almost every time.

### The activation rule

Setting `TTC_MATCHER_URL` on the routing host is what moves `GET /api/live-coverage`'s `ttc`/`ttc-next` entries from `published-unjoinable` to `shadow` (see [docs/data/API.md](../data/API.md)) - that only means the matcher is deployed and being measured. Nothing in this repository automatically points a `stop-time-updater` at the matcher's rewritten feed: `backend/otp/router-config.json` carries no such entry today. Activation is a deliberate, separate, recorded step: an operator reads `/internal/ttc/match-stats`, confirms the rolling 24-hour gate has actually passed (not merely that one poll looked good), and only then adds the `stop-time-updater` entry pointing at `http://ttc-matcher:8790/internal/ttc/trips` and records that change. Until that happens, TTC's live updates take no part in routing, regardless of how healthy the shadow matcher's own numbers look.

Suggested articles: [vehicle assignment](assignment.md), [live vehicle sources](README.md), [routing backend API](../data/API.md), [real-time GTFS coverage](../realtime/README.md).
