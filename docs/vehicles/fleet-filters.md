# Fleet filters

`lib/fleet-filter.ts` filters an already ordered list of vehicles using only
the vehicle's supplied CPTDB metadata. It does not infer manufacturer, model,
or build year from a route, trip, agency, label, or nearby fleet number.

## Filter values

`FleetFilter` has a manufacturer, model, optional inclusive year bounds, and
an `includeUnknown` choice. `emptyFleetFilter()` returns a new blank filter for
each caller.

Manufacturer and model comparisons are exact after Unicode NFKC normalization,
trimming, and case normalization. They do not perform prefix, substring, or
pattern matching. A model criterion is invalid until a manufacturer is also
selected. `filterFleetVehicles()` returns this error and an empty result in that
case:

```text
Select a manufacturer before filtering by model.
```

`manufacturerOptions()` returns distinct, sorted manufacturer labels found in
the supplied CPTDB records. `modelOptions()` returns distinct, sorted model
labels only for the selected normalized manufacturer. Neither function has a
hard-coded manufacturer or reads similarly named vehicle properties outside
`cptdb`.

## Year ranges

Year input is strict: a nonblank bound must be a four-digit whole year from
1800 through 3000. A reversed interval also returns an explicit error and no
vehicles, so a malformed filter cannot silently become a broader match.

Published CPTDB year metadata may be a numeric year or a bounded two-year range
such as `2007-2010`. A requested range matches a published range when the two
ranges overlap. For example, a request for 2009 through 2012 includes a vehicle
whose published range is 2007 through 2010. This is a comparison of the
published fleet range, not a claim about an individual vehicle's exact build
date. Missing or malformed published year metadata is unknown rather than a
match.

## Unknown metadata and counts

With no manufacturer, model, or year criterion, the helper is inactive and
returns every vehicle, including those without CPTDB facts. `includeUnknown`
alone does not activate filtering.

With an active criterion, a vehicle with a missing or malformed required fact is
an unknown candidate only when every other known required fact matches. Unknown
candidates are excluded by default and included only when `includeUnknown` is
true. A known mismatch always remains excluded, even when another required
field is unknown.

The result preserves the source order and never changes the input array or a
vehicle object. It reports `unknownCount` for unknown candidates, and
`excludedUnknownCount` for the portion excluded because `includeUnknown` is
false. The helper does not execute a caller-provided regular expression; the UI
owns free-text searching through the bounded Search Workbench.
