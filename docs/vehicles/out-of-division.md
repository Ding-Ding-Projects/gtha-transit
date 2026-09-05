# TTC out-of-division observations

This feature compares fresh TTC vehicle positions with the route and fleet allocation tables in the official TTC Service Summary. The current source covers July 26 through September 5, 2026 and its fleet allocation was updated July 27, 2026. The checked source is 1,592,234 bytes with SHA-256 `5A81E7680049BDFADDD9187C1867AE966939B0E5D35085E4EF583D77CEE1466C`.

## Classification

A vehicle is reported out of division only when all of these conditions hold:

1. The vehicle comes from a live TTC snapshot and its observation is no more than 120 seconds old.
2. The official source is within its stated validity dates.
3. The vehicle number belongs to a fleet series assigned to exactly one garage in the source.
4. The route appears in the complete route allocation and none of its assigned garages is the vehicle series garage.

Multi-garage fleet series remain `unknown` because the public table does not say which individual unit belongs to which garage. An expired source, missing route, stale vehicle, unsupported agency, or unknown fleet range also remains `unknown`. The interface must not describe an unknown record as in division or out of division.

## Observed-frequency rarity

The local sighting store uses SQLite and records at most one observation per vehicle, route, and Toronto calendar day. It stores identifiers and timestamps only, never coordinates. Records are retained indefinitely and are never backfilled. The normal query examines a rolling 30-day window.

Observed frequency is `distinct days this vehicle was seen on this route / distinct days this route was observed × 100`. A badge is withheld until the route has at least seven observed days. The inclusive labels are Omega at 1% or less, Legendary at 5% or less, Epic at 15% or less, Rare at 35% or less, Uncommon at 65% or less, and Common above 65%.

The result always includes both sample counts, the Toronto date window, and the statement that historical observations are not a prediction of a future assignment. No historical observations are invented or backfilled.

## Sources and refresh

The publisher page is [TTC Transit Planning](https://www.ttc.ca/transparency-and-accountability/transit-planning). The current file is [Service Summary, July 26 to September 5, 2026](https://cdn.ttc.ca/-/media/Project/TTC/DevProto/Documents/Home/Transparency-and-accountability/Service-Summary-2026-07-26.pdf?rev=e6ea84654386468186317a3c3c440c89). Refresh code must discover the current file from the publisher page, validate it, retain the previous validated data on a failed refresh, and never guess a future filename.

## API filter

`GET /api/vehicles/divisions` returns all loaded TTC vehicles with a `division` object containing the classification, official source receipt, possible home garage, route garage set, and local observed-frequency result. It accepts `classification=all|out-of-division|in-division|unknown`, `route`, `q`, `limit`, and `cursor`. The default page size is 100 and the maximum is 100. The response computes `counts.all`, `counts.outOfDivision`, `counts.inDivision`, and `counts.unknown` before applying the requested filter, so an empty out-of-division page can be distinguished from unavailable or ambiguous evidence.

When `HISTORY_DIR` is configured, the server records one fresh TTC snapshot every 60 seconds in the local SQLite sighting store. It retains only vehicle identifier, route identifier, Toronto calendar day, and observation timestamp. Coordinates are never written. Without that configured local history, each vehicle reports an unavailable observed-frequency result rather than a guessed rarity.
