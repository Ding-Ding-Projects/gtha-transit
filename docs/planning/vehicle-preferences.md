# Vehicle preferences

Journey vehicle preferences are a local, pure planning step. They operate only on vehicle facts already attached to a journey leg at `leg.vehicle.cptdb`. The evaluator does not infer a vehicle from a route, operator, trip pattern, or schedule, and it never fetches data or mutates a journey.

## Criteria

`manufacturer` and `model` are separate exact comparisons after Unicode-normalising, trimming, and case-folding the supplied value and the assigned CPTDB value. A manufacturer match does not imply a model match, and vice versa.

The optional `yearFrom` and `yearTo` form an inclusive requested build-year interval. CPTDB often publishes an interval rather than one year. A published interval contained by the request matches, a disjoint interval does not match, and a partial overlap is reported as `unknown`. Missing assigned vehicle facts are also `unknown`.

Use `match: 'all'` for every supplied criterion, or `match: 'any'` for either criterion. Evaluations are three-valued: `true`, `false`, or `unknown`.

## Policy

Walking legs are ignored. A prefer policy is a stable soft boost: itineraries with a verified matching assigned vehicle move ahead of other retained itineraries while preserving their original order. Unknown assignments are retained and explicitly labelled.

An avoid policy removes an itinerary with a known matching assigned vehicle leg. Because an unconfirmed vehicle cannot prove that a traveller will avoid the requested vehicle, avoid also removes itineraries with any unconfirmed non-walking vehicle assignment by default. Set `includeUnconfirmed: true` to retain those itineraries.

`evaluateJourneyPreferences(itinerary, criteria, options)` returns per-leg evidence. `applyJourneyPreferences(itineraries, criteria, options)` returns retained and excluded itinerary records with reasons and that evidence, without changing the supplied data.

## Preference panel integration

The planner exposes this panel below Journey preferences. Its choices persist in the browser and re-evaluate the returned options immediately, without claiming that every possible later departure was searched. The original returned options remain in memory, so clearing an avoidance choice restores them. Available choice labels come from the verified fleet registry; actual matching uses only fresh vehicles attached to journey legs.

`components/journey-vehicle-preferences.tsx` is an accessible controlled panel for criteria and policy state. Its parent supplies `verifiedFleetFacts` from already verified fleet facts, including CPTDB or official agency sources, owns the state callbacks, calls `applyJourneyPreferences` independently, and returns the resulting excluded count to the panel. The component never fetches data and does not attempt routing integration.

The panel follows a company-first sequence. It shows verified company chips in step 1, leaves step 2 disabled until a company is selected, and then shows only models whose verified metadata carries that exact manufacturer. Changing or clearing the company clears the selected model. This prevents a model from one company being paired with another company. Step 3 provides optional build years. Advanced matching and unknown-assignment choices stay progressively disclosed.

Avoid mode explains that unknown non-walking assignments are excluded by default and exposes the explicit `includeUnconfirmed` recovery option. The panel validates entered years locally before it calls the parent: each must be a whole year from 1800 through 3000, and the start year cannot be after the end year. Invalid intervals are reported inline and never silently reordered. Its visible structural seams are `vehicle-pref-panel`, `vehicle-pref-step`, `vehicle-pref-chip`, `vehicle-pref-policy`, and `vehicle-pref-year-grid`; the parent-owned stylesheet supplies their appearance.
