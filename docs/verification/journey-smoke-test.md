# The journey smoke test

`node scripts/smoke-journeys.mjs [origin]` asks the deployed service the question a
rider actually asks: resolve two places by name, then plan a real journey between
them. Nothing is mocked, and the default origin is the public site.

## What it covers

Fourteen pairs, each labelled with the mode it exists to exercise.

**Toronto** — subway end to end, a bus north from a subway terminal, a streetcar
across downtown, the airport rail link, suburb to suburb across the city, and the
east end to the west end.

**The wider region** — Lakeshore West from Hamilton, Lakeshore East from Durham,
Mississauga city centre inbound, Halton inbound, Peel on the Kitchener corridor,
the Barrie corridor, York Region inbound, and one pair that crosses the region
without passing through downtown.

## A service gap is not a failure

A corridor with a long evening or weekend gap genuinely has no journey at some
hours. Reporting that as a failure would be a false alarm about the service
rather than a fact about it.

So a pair that finds nothing is asked again at the next weekday mid-morning. An
answer there means the timetable is loaded and the first attempt simply landed in
a gap, and the row is reported as **gap** with the time the retry succeeded at.
Only a pair that finds nothing at either time is a **FAIL**, and only a FAIL sets
a non-zero exit code.

This distinction is the point of the script. "No route" and "the planner is down"
look the same to a rider, and they must not look the same here.

## Reading a run

```
ok   Toronto  Union Station -> Kipling Station          39 min  10 options  GO Transit KI > TTC 2
gap  Regional Allandale Waterfront GO -> Union Station  no departure at this hour; 1 found at 2026-09-07T13:00:00.000Z

13/14 planned, 1 with no departure at this hour, 0 failed
agencies reached: GO Transit, TTC, UP Express, York Region Transit
legs carrying a block chain: 22
```

The last two lines are the ones worth watching. **Agencies reached** falls when a
feed stops being loaded or a corridor stops resolving, which no single pair would
reveal. **Legs carrying a block chain** falls when the block lookup breaks, and
that number is a live count from real plans rather than a test fixture.

`--json` emits the whole record, including each pair's resolved place names,
itinerary count, agencies, transfer count, observed vehicle-assignment states and
elapsed milliseconds.

## What it does not prove

It exercises place search, planning, agency coverage and the block chain through
the real service. It says nothing about how any of that renders, and a green run
is not a substitute for driving the built interface.

Suggested articles: [following the vehicle from its previous trip](../vehicles/vehicle-blocks.md),
[interface verification](../interface/ui-verification.md).
