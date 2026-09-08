# TTC out-of-division observations

This feature compares fresh TTC vehicle positions with the route and fleet allocation tables in the official TTC Service Summary. The current source covers September 6 through October 31, 2026 and its fleet allocation was updated August 28, 2026. The checked source is 1,610,076 bytes with SHA-256 `980A04D2378C73501B3926D6D45FC4688CA05EBFBE2005077AF96CC50E1EC234`.

## Classification

A vehicle is reported out of division only when all of these conditions hold:

1. The vehicle comes from a live TTC snapshot and its observation is no more than 120 seconds old.
2. The official source has started. A summary whose period has not begun says nothing about today, so it is refused.
3. The vehicle number belongs to a fleet series assigned to exactly one garage in the source.
4. The route appears in the complete route allocation and none of its assigned garages is the vehicle series garage.

Multi-garage fleet series remain `unknown` because the public table does not say which individual unit belongs to which garage. A missing route, stale vehicle, unsupported agency, or unknown fleet range also remains `unknown`. The interface must not describe an unknown record as in division or out of division.

## When the period has ended

Only the near end of the validity window is a boundary. Once a period ends, the summary is
still the last allocation the operator published, and every surface keeps answering from it
while saying which period it describes. Allocations move slowly and a dated answer beats
none; refusing left every vehicle unclassified for the whole gap between board periods,
which reads as "we found nothing" rather than "the answer is a few days old".

This was not always consistent. The vehicle tracker, the garage picker and the division
verdict each answered with a dated caveat, while the journey-level preference and the route
opportunity beside it read the window as closed at both ends and went silent the moment a
period ended. In September 2026 that split ran for three days: the tracker showed garages
with a caveat while "prefer out-of-division vehicles" quietly stopped moving anything and
the *Verified out of division* badge disappeared, with nothing on either surface saying why.
All four now agree, and `tests/division-disclosure.test.mjs` holds them together.

The answer carries `sourceCoverage`, which is `current`, `last-published`, or
`not-yet-in-effect`, so nothing downstream can present an out-of-period answer as a current
one. The date in the receipt is never edited to make old data look current.

## Observed-frequency rarity

The local sighting store uses SQLite and records at most one observation per vehicle, route, and Toronto calendar day. It stores identifiers and timestamps only, never coordinates. Records are retained indefinitely and are never backfilled. The normal query examines a rolling 30-day window.

Observed frequency is `distinct days this vehicle was seen on this route / distinct days this route was observed × 100`. A badge is withheld until the route has at least seven observed days. The inclusive labels are Omega at 1% or less, Legendary at 5% or less, Epic at 15% or less, Rare at 35% or less, Uncommon at 65% or less, and Common above 65%.

The result always includes both sample counts, the Toronto date window, and the statement that historical observations are not a prediction of a future assignment. No historical observations are invented or backfilled.

## Sources and refresh

The publisher page is [TTC Transit Planning](https://www.ttc.ca/transparency-and-accountability/transit-planning). The current file is [Service Summary, September 6 to October 31, 2026](https://cdn.ttc.ca/-/media/Project/TTC/DevProto/Documents/Home/Transparency-and-accountability/Service-Summary-2026-09-06.pdf?rev=8a73444f06f74841991fef5d61041cfc). Refresh code must discover the current file from the publisher page, validate it, retain the previous validated data on a failed refresh, and never guess a future filename. The `?rev=` hash makes a constructed filename impossible in any case.

`node scripts/check-ttc-summary.mjs` reads the publisher page and reports whether a summary
newer than the shipped receipt has been posted, and how far past its period the shipped one
is. It makes a real network request, so it is not part of `npm test`; run it when the period
is near its end. It reports and never gates: data outside its period is the intended state
between board periods, and a check that went red for it would be red for days at a time over
behaviour the project chose on purpose.

### How the tables are read

The summary states each route's division three times, in an alphabetical list, a numerical
list, and a list by operating division. A refresh reads all three and accepts only what they
agree on. Four routes needed settling against their own entry in the body of the document,
and each is recorded with the sentence it came from: 996 (one list's cell bled across a
column boundary), 306 and 506 Carlton (the only two cells in the document that wrap, losing
the leading `Rus`), and 386 Scarborough (absent from all four index pages, which is an
omission in the summary's own index).

Geometry is not used. Pairing a route to the nearest division code by position fails, because
a code is right-aligned in its column and sits closer to the next column's route number than
to its own; pairing by index within a visual row fails too, because the four columns are not
aligned in y and rows bleed together. The PDF's content stream is written column by column,
so a route's line is immediately followed by its own division code.

## API filter

`GET /api/vehicles/divisions` returns all loaded TTC vehicles with a `division` object containing the classification, official source receipt, possible home garage, route garage set, and local observed-frequency result. It accepts `classification=all|out-of-division|in-division|unknown`, `route`, `q`, `limit`, and `cursor`. The default page size is 100 and the maximum is 2,500 for bounded map loading; the visible list remains paginated at 100 rows. The response computes `counts.all`, `counts.outOfDivision`, `counts.inDivision`, and `counts.unknown` before applying the requested filter, so an empty out-of-division page can be distinguished from unavailable or ambiguous evidence.

When `HISTORY_DIR` is configured, the server records one fresh TTC snapshot every 60 seconds in the local SQLite sighting store. It retains only vehicle identifier, route identifier, Toronto calendar day, and observation timestamp. Coordinates are never written. Without that configured local history, each vehicle reports an unavailable observed-frequency result rather than a guessed rarity.
