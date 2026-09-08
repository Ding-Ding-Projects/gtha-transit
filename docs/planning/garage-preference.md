# Choosing the garages you would rather ride

Some riders care which garage a bus came from. This control lets them say so, and
is careful about what it can honestly promise.

## What it can and cannot know

No feed says which vehicle a departure will be before it arrives. A journey planner
works from the timetable, and the timetable names routes rather than buses, so a
control that claimed to plan you onto a specific garage's vehicle would be inventing
its answer.

What the TTC does publish is which garage runs which route. That is the fact this is
built on, and the panel says so in its own copy rather than leaving a rider to infer
it. Selecting garages moves journeys that ride their routes to the top.

## It orders, and never filters

Nothing is hidden. A journey that rides none of the chosen garages is still returned,
last, as an alternate, and the panel reports how many options ride them the whole way.
This matters because the alternative is a planner that silently withholds the only
route that works, which is worse than a preference nobody applied.

Journeys are placed in three bands: every leg on a chosen garage's route, some legs,
and none. Order within a band is unchanged, so the underlying priority the rider
picked, fastest or fewest transfers, still decides between equals.

## Show more details

Each garage expands to the routes it operates and the vehicles running on those routes
at that moment, read from the live feed. The list is what is out there now, not a
prediction about the departure being planned, and the panel does not present it as one.
When the live feed does not answer, the detail says that rather than showing an empty
list, which would read as a garage with nothing running.

## When the allocation source has ended

Garage assignments come from a published TTC allocation summary that covers a service
period. When that period ends and no replacement has been published, the panel keeps
answering from the last published summary and states the date it covers. Allocations
move slowly, so the last published answer is more useful than none, but it describes
that period rather than today and the copy says exactly that. A summary whose period
has not started yet is refused, because that is a claim about the future.

## Failure modes

An unreadable or absent registry leaves the panel out rather than showing an empty
garage list. A live feed that does not answer disables only the vehicle list inside a
detail. Neither state changes the journeys that were returned, and neither is reported
as a preference that was applied.

## Privacy

Selections are held in the browser and travel with the journey request only as garage
codes. No location, no identity, and nothing about the rider is added by this control.

## Verification

`tests/garage-preference.test.mjs` covers the three bands, the refusal to filter, the
expired and not-yet-started source states, and the disclosure counts. The control is
driven in the built artifact by the interaction ledger at four tuples: a garage is
preferred, expanded to its routes and live vehicles, collapsed, and cleared, with a
capture after every click.

Suggested articles: [Journey vehicle preferences](vehicle-preferences.md),
[Out of division](../vehicles/division-verdict.md), [Planning](README.md).
