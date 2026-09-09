# Vehicle preferences

Journey vehicle preferences are a local, pure planning step. They operate only on vehicle facts already attached to a journey leg at `leg.vehicle.cptdb`. The evaluator does not infer a vehicle from a route, operator, trip pattern, or schedule, and it never fetches data or mutates a journey.

## Criteria

`manufacturer` and `model` are separate exact comparisons after Unicode-normalising, trimming, and case-folding the supplied value and the assigned CPTDB value. A manufacturer match does not imply a model match, and vice versa.

The optional `yearFrom` and `yearTo` form an inclusive requested build-year interval. CPTDB often publishes an interval rather than one year. A published interval contained by the request matches, a disjoint interval does not match, and a partial overlap is reported as `unknown`. Missing assigned vehicle facts are also `unknown`.

Use `match: 'all'` for every supplied criterion, or `match: 'any'` for either criterion. Evaluations are three-valued: `true`, `false`, or `unknown`.

`propulsion: 'electric'` is a separate criterion. It accepts published battery-electric vehicles and electrically powered streetcars. A hybrid, diesel, or natural-gas vehicle is a confirmed non-match. A missing or unrecognised published propulsion is `unknown`, never an electric match. The classifier reads only the existing `propulsion` fact, except for regional rows explicitly documented as a manufacturer-backed model designation.

## Policy

Walking legs are ignored. A prefer policy is a stable soft boost: itineraries with a verified matching assigned vehicle move ahead of other retained itineraries while preserving their original order. Unknown assignments are retained and explicitly labelled.

An avoid policy removes an itinerary with a known matching assigned vehicle leg. Because an unconfirmed vehicle cannot prove that a traveller will avoid the requested vehicle, avoid also removes itineraries with any unconfirmed non-walking vehicle assignment by default. Set `includeUnconfirmed: true` to retain those itineraries.

`evaluateJourneyPreferences(itinerary, criteria, options)` returns per-leg evidence. `applyJourneyPreferences(itineraries, criteria, options)` returns retained and excluded itinerary records with reasons and that evidence, without changing the supplied data.

For the electric control, `matchedCount` and `unknownCount` describe retained results. In Avoid mode, excluded records identify whether they were hidden for a verified electric match or an unconfirmed assignment, so the status text can report the reason without guessing from the rendered list.

## Preference panel integration

The planner shows a compact Vehicle preferences summary below Journey preferences. It opens a dedicated dialog that uses the available desktop width, or Company, Model and Years steps on a narrow screen. Edits stay in a draft until Apply preferences. Cancel, the close button and Escape discard the draft and return focus to the originating control. Reset changes the draft only. Applied choices persist through the existing browser preference writer and re-evaluate returned options without claiming that every later departure was searched. The original options remain in memory, so removing avoidance restores them.

`components/journey-vehicle-preferences.tsx` is an accessible controlled panel for criteria and policy state. Its parent supplies `verifiedFleetFacts` from already verified fleet facts, including CPTDB or official agency sources, owns the state callbacks, calls `applyJourneyPreferences` independently, and returns the resulting excluded count to the panel. The component never fetches data and does not attempt routing integration.

The chooser follows a company-first sequence. Manufacturer and model lists have separate local searches, each with its own anchored star workbench. Models appear only after a manufacturer is selected and come from that manufacturer's verified metadata. Changing company clears an incompatible model and resets the model search. Any manufacturer and Any model provide explicit clearing paths. The Years step accepts either or both endpoints, with [documented inclusive bounds](year-matching.md), and offers all/any matching.

Off, Prefer and Avoid are exclusive choices. A stored legacy combination of both flags displays Avoid, matching the evaluator's exclusion precedence; Apply normalizes it to one mode. Avoid immediately exposes Keep unconfirmed journeys and explains that leaving it off can hide every result when assignments are unavailable. The number of hidden results is also shown beside the closed summary. TTC garage preferences are a separate visible disclosure, retaining their exact-trip and current-route evidence choices.

Years must be complete integers from 1800 through 3000; reversed or partial values remain visible and prevent Apply. A persistent explanation and Edit years action focus the affected section. Invalid stored ranges are labelled Review years and do not hide or reorder journeys. The modal scrolls internally with a persistent action footer. Its searches and inputs prevent implicit submission of the surrounding journey form while action-button keyboard activation remains available.

## Electric vehicles

A separate Electric vehicles card sits beside the manufacturer/model/year vehicle preferences panel. It answers one narrow question: does the vehicle assigned to a journey leg run on a verified battery-electric or electric propulsion, as classified by [`vehicles/propulsion.mjs`](../../vehicles/propulsion.mjs) from the same published CPTDB `propulsion` fact the fleet registry already carries? It never infers propulsion from a route, a manufacturer, or a model name on its own; the classifier only recognises the specific propulsion text a roster actually publishes.

**What counts as electric.** A battery-electric bus and an electric (streetcar) vehicle both count. A hybrid, a diesel or diesel-electric vehicle, a natural-gas vehicle, and anything whose propulsion string is not recognised do not count, even when the vehicle's name contains the word "electric" as part of a compound description - a "Diesel-electric hybrid" bus classifies as hybrid, and a "Diesel-electric" locomotive classifies as diesel, because neither is a plug-in electric vehicle. See [Fleet filters](../vehicles/fleet-filters.md) for the equivalent classification used by the fleet map and list, and [Regional fleet research](../vehicles/regional-research.md) for where each manufacturer's electric model designations are sourced.

**Unknown handling.** A journey leg with no assigned vehicle, or an assigned vehicle whose propulsion is not published or not recognised, is unknown - never treated as electric and never treated as a confirmed non-electric match either. This is the same true/false/unknown evaluation the manufacturer, model and year criteria already use, applied to a single `propulsion: 'electric'` criterion.

**Off, Prefer and Avoid.** The three choices work exactly like the manufacturer/model/year policy, but as an independent pass: turning the electric preference on or off never disturbs the manufacturer/model/year evidence, and vice versa, because the two never share one criteria object. Off leaves trip order unchanged. Prefer applies a stable boost so itineraries with a verified electric assigned vehicle move ahead of other retained itineraries, keeping their relative order otherwise. Avoid removes itineraries with a verified electric assigned vehicle and, because an unconfirmed assignment cannot prove a traveller will avoid one, also removes itineraries with any unconfirmed non-walking vehicle assignment by default; the Keep journeys whose vehicle is unconfirmed checkbox (shown only once Avoid is chosen) retains those instead. The pass composes after the manufacturer/model/year preference and before the TTC garage/division preference, on whichever itineraries that first pass already returned.

**Honest scope.** The result reflects only the vehicle currently assigned or reported for a journey leg, exactly as published; it is not a claim about an agency's fleet-wide electrification, and it cannot promise a specific vehicle will actually operate a future departure. The summary line under the card states the matched and hidden counts so this scope is visible, not just documented here, and a persistent note repeats that unconfirmed assignments are never counted as electric.

`lib/journey-vehicle-controls.ts` carries the compact `ElectricPreference` shape (`{ mode: 'off' | 'prefer' | 'avoid', includeUnconfirmed: boolean }`) the panel and the persisted browser preferences share. `parseElectricPreference` validates a persisted or otherwise untrusted value, defaulting an unrecognised mode to `off` and a missing or non-boolean unconfirmed flag to the default (keep unconfirmed); `electricOptions` converts the compact shape into the evaluator's `prefer`/`avoid` options. `DEFAULT_ELECTRIC_PREFERENCE` starts at `off`, so the preference can only narrow results once a traveller actually chooses Avoid.

## Verification and evidence limits

The control-helper tests cover verified catalogs, manufacturer/model relationships, exclusive modes, legacy flag precedence, non-mutating drafts, open year endpoints and invalid input. The evaluator tests cover the actual matching rules, including the electric criterion: a verified match boosts under Prefer and is excluded under Avoid, an unknown assignment never counts as electric and is kept only with `includeUnconfirmed`, and the reported matched/unknown/excluded counts are exercised directly. `tests/propulsion.test.mjs` separately enumerates every distinct propulsion string either roster module actually publishes and checks it against a maintained expected classification, so a newly published propulsion string that the classifier does not recognise fails that test rather than silently reporting `unknown`. These replace older markup/class-name assertions; they are not proof of rendered behavior. Built-browser inspection and source/release revisions are recorded in [HANDOFF.md](../../HANDOFF.md). Physical touch and full language/scale coverage remain separate requirements.

Suggested articles: [Build-year matching](year-matching.md), [Search workbench](../search/regex-builder.md), [Fleet filters](../vehicles/fleet-filters.md), [Regional fleet research](../vehicles/regional-research.md), [Planning](README.md).
