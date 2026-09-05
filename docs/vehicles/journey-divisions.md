# Journey out-of-division evidence

`annotateJourneyDivisions(itineraries, registry, { now })` adds `vehicleDivision` evidence to copied journey legs. It evaluates only an existing vehicle assignment marked `matched` with the `exact-trip-id` method, a TTC feed identity, a published route ID, and a leg time interval containing `now`.

The module never attaches a vehicle from a route, direction, headsign, position, or timetable match. A route-only record, past or future leg, stale vehicle, expired source, multi-garage fleet series, missing route, or invalid time remains `unknown` with a reason. Verified records preserve the official source date, home-garage name, and route-garage evidence returned by the dated allocation registry.

```js
import { annotateJourneyDivisions, applyJourneyDivisionPreference } from './vehicles/journey-divisions.mjs';

const evidence = annotateJourneyDivisions(itineraries, registry, { now: Date.now() });
const preferred = applyJourneyDivisionPreference(evidence.itineraries, { enabled: true });
```

The soft preference is a stable partition: it moves only itineraries containing a verified `out-of-division` leg ahead of the others. It preserves relative order within both groups and never boosts unknown or route-only evidence. Its result includes the original options, verified-match count, unknown-itinerary count, and reason counts.
