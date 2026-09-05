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

The planner shows a compact Vehicle preferences summary below Journey preferences. It opens a dedicated dialog that uses the available desktop width, or Company, Model and Years steps on a narrow screen. Edits stay in a draft until Apply preferences. Cancel, the close button and Escape discard the draft and return focus to the originating control. Reset changes the draft only. Applied choices persist through the existing browser preference writer and re-evaluate returned options without claiming that every later departure was searched. The original options remain in memory, so removing avoidance restores them.

`components/journey-vehicle-preferences.tsx` is an accessible controlled panel for criteria and policy state. Its parent supplies `verifiedFleetFacts` from already verified fleet facts, including CPTDB or official agency sources, owns the state callbacks, calls `applyJourneyPreferences` independently, and returns the resulting excluded count to the panel. The component never fetches data and does not attempt routing integration.

The chooser follows a company-first sequence. Manufacturer and model lists have separate local searches, each with its own anchored star workbench. Models appear only after a manufacturer is selected and come from that manufacturer's verified metadata. Changing company clears an incompatible model and resets the model search. Any manufacturer and Any model provide explicit clearing paths. The Years step accepts either or both endpoints, with [documented inclusive bounds](year-matching.md), and offers all/any matching.

Off, Prefer and Avoid are exclusive choices. A stored legacy combination of both flags displays Avoid, matching the evaluator's exclusion precedence; Apply normalizes it to one mode. Avoid immediately exposes Keep unconfirmed journeys and explains that leaving it off can hide every result when assignments are unavailable. The number of hidden results is also shown beside the closed summary. TTC garage preferences are a separate visible disclosure, retaining their exact-trip and current-route evidence choices.

Years must be complete integers from 1800 through 3000; reversed or partial values remain visible and prevent Apply. A persistent explanation and Edit years action focus the affected section. Invalid stored ranges are labelled Review years and do not hide or reorder journeys. The modal scrolls internally with a persistent action footer. Its searches and inputs prevent implicit submission of the surrounding journey form while action-button keyboard activation remains available.

## Verification and evidence limits

The control-helper tests cover verified catalogs, manufacturer/model relationships, exclusive modes, legacy flag precedence, non-mutating drafts, open year endpoints and invalid input. The evaluator tests cover the actual matching rules. These replace older markup/class-name assertions; they are not proof of rendered behavior. Built-browser inspection and source/release revisions are recorded in [HANDOFF.md](../../HANDOFF.md). Physical touch and full language/scale coverage remain separate requirements.

Suggested articles: [Build-year matching](year-matching.md), [Search workbench](../search/regex-builder.md), [Planning](README.md).
