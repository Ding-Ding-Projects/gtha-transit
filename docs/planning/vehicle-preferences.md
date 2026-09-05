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

`components/journey-vehicle-preferences.tsx` is an accessible controlled panel for criteria and policy state. Its parent supplies `verifiedFleetFacts` from already verified fleet/CPTDB data, owns the state callbacks, calls `applyJourneyPreferences` independently, and returns the resulting excluded count to the panel. The component never fetches data and does not attempt routing integration.

Manufacturer and model choices are independent button-chip groups, populated only from the supplied facts. The panel uses ordinary number inputs for an inclusive year interval and button chips for `all` or `any` matching. It has no fake select control.

Avoid mode explains that unknown non-walking assignments are excluded by default and exposes the explicit `includeUnconfirmed` recovery option. No search field is included yet: every future field requires its own adjacent full regular-expression builder, so this panel will connect to the shared builder only once that real component exists.
