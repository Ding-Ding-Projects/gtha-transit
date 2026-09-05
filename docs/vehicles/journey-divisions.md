# Journey out-of-division evidence

`annotateJourneyDivisions(itineraries, registry, { now })` adds `vehicleDivision` evidence to copied journey legs. It evaluates only an existing vehicle assignment marked `matched` with the `exact-trip-id` method, the exact `ttc` or `ttc-next` feed identity, and a published route ID. A fresh assigned vehicle can support an in-progress leg or an upcoming boarding beginning within two hours. A completed leg or a leg more than two hours ahead remains unknown because the assigned vehicle can change.

The module never attaches a vehicle from a route, direction, headsign, position, or timetable match. A route-only record, completed or too-distant leg, stale vehicle, expired source, multi-garage fleet series, missing route, vehicle-route mismatch, or invalid time remains `unknown` with a reason. Walking legs are ignored. Verified records preserve the official source date, home-garage name, and route-garage evidence returned by the dated allocation registry.

```js
import { annotateJourneyDivisions, applyJourneyDivisionPreference } from './vehicles/journey-divisions.mjs';

const evidence = annotateJourneyDivisions(itineraries, registry, { now: Date.now() });
const preferred = applyJourneyDivisionPreference(evidence.itineraries, { enabled: true });
```

The soft preference is a stable partition: it moves only itineraries containing a verified `out-of-division` leg ahead of the others. It preserves relative order within both groups and never boosts unknown or route-only evidence. Its result includes the original options, verified-match count, unknown-itinerary count, and reason counts.

The web proxy annotates only after exact-trip vehicle enrichment. The browser imports the standalone `vehicles/journey-division-preference.mjs` module, which contains no filesystem dependency. Every usable result carries its check time and an expiry bounded by the vehicle observation's 120-second freshness and the leg end. The browser rechecks that deadline and the Toronto allocation date; expired cached evidence loses its boost. Selection follows itinerary identity so an automatic reranking does not silently select another trip.

Open Vehicle preferences in the planner to enable Prefer out-of-division vehicles. It is off by default, persists locally and travels with saved trips, share links and JSON exports. Existing avoidance filters apply before this soft ranking. Options with unconfirmed evidence remain visible, and the interface reports when no verified match exists. A current assignment can change before boarding.
