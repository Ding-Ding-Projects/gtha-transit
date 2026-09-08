# The whole-network station checklist

A subway speed run means reaching every station, so the run needs a list of every
station and a record of which ones have been reached.

## Where the stations come from

They are derived from the published feed rather than written down. The TTC publishes
one stop per platform and leaves the parent station field empty on all of them, so a
hand-kept list would be a second source to maintain and to get wrong.

The station name is read from the platform name, and the result is checked against the
operator's own published counts: 38 on Line 1, 31 on Line 2, 5 on Line 4, 25 on Line 5
and 18 on Line 6. All five match, for 110 distinct stations once the seven interchanges
that serve more than one line are counted once.

Those counts are a test, not a comment. A feed change that split or merged a station
moves a count and fails, rather than quietly changing what a complete run means.

## What a tick means

A station is ticked when this team recorded a check-in naming it, matched on the exact
published name. A near miss does not tick a station, because a run that can be finished
without going somewhere is not the run anyone entered.

Photo proof is required for a check-in. The surface is explicit that nothing verifies
the photo shows the station it names: this is a record of what was claimed and when,
not a verification, and saying so is the difference between a leaderboard and a claim
nobody can check.

## Progress

Progress is a native progress element carrying the same numbers that appear as text
beside it, so it is readable without seeing a colour or a length, and screen readers get
the platform's own announcement rather than one described by an attribute.

The first line opens on load, because a wall of five collapsed lines tells a rider
nothing. The rest are collapsed and open on demand.

## Failure modes

If the station list cannot be read, the surface says a run cannot be measured against
the whole network right now, and does not show a partial list that would understate what
a complete run requires.

## Verification

`tests/rapid-transit-stations.test.mjs` covers the name derivation, the five published
counts, the interchange handling and the total. The checklist is driven in the built
artifact by the interaction ledger at four tuples: a speed run room is created, a team
added and joined, and a collapsed line opened to its stations, with a capture after every
click.

Suggested articles: [Race](README.md), [Live follower](../planning/live-follower.md),
[Vehicle tracking](../vehicles/README.md).
