# Identifying the vehicle on a leg

A journey leg shows a vehicle only when the published data actually identifies one. There are two ways it can, and the interface always says which was used.

## Why an exact trip identifier is not enough for the TTC

Measured against the live feeds on 6 September 2026: of **406** trip identifiers published in the TTC realtime vehicle feed, **104** also existed in the loaded static timetable, but only **one** of those carried the same route.

The realtime identifier space is therefore not the static one. An identifier that appears in both is almost always a number collision between unrelated trips, which means an identifier match on its own can name a bus from a completely different route. The exact join now requires the route to match as well, so a collision assigns nothing.

## The stop identifiers do not join either

The same check on stop identifiers is worse. Of the **192** live TTC vehicles whose reported stop identifier also existed in the loaded timetable, **not one** was within 300 metres of that timetable's stop. Distances ran to tens of kilometres: a vehicle reporting stop `1110` sat 23 km from the stop the timetable calls `1110`.

So a stop-identifier match is a number collision too, and a join built on it would name the wrong vehicle rather than none. The position join therefore compares **published coordinates**, which cannot collide by numbering.

## The position join

When no exact identifier matches, a vehicle is identified only if all of the following hold at once:

- it is on the leg's own route, compared on the feed-qualified route identity;
- its published position is within 150 metres of the stop **where this trip should be right now**, measured as a great-circle distance between the two published coordinates. The expected stop comes from the publisher's own stop times: the stop nearest the current moment, and one either side of it to allow for a bus in motion;
- the observation falls inside the leg's own window, from twenty minutes before boarding to five minutes after arrival;
- its position is fresh, not stale.

If exactly one vehicle satisfies all of that, it is shown with a visible note explaining that it was identified by position rather than by trip identifier. If more than one does, the leg reports that several vehicles qualify and names none. **Route equality alone never assigns a vehicle.**

## Why the expected position, and not any stop on the leg

A long bus leg passes dozens of stops. Asking whether a vehicle is near **any** of them matched most of the route's fleet at once: a route 68 leg with 42 intermediate stops reported that several vehicles qualified and named none, which is no more useful than finding nothing. The stop times now available for every intermediate stop place the trip precisely, so the question became whether a vehicle is where this trip should be - which is the vehicle the rider will actually board.

## Before a departure has started

A tracker normally carries a vehicle from its previous trip into the next one, because its realtime feed and its timetable share trip or block identifiers. This operator's do not - measured above - so that chain cannot be built from published data and is not pretended here.

What is offered instead is a measured fact: the **closest vehicle on this route to your boarding stop**, with its distance. It is labelled as exactly that. It is not called the assigned vehicle, because nothing published ties a vehicle to a departure, and a vehicle more than 25 km away is not described as approaching at all.

## What is not claimed

A position match is titled **Vehicle seen on this leg**, not *Currently assigned vehicle*, because that is all it establishes. On a corridor with departures a few minutes apart, the same observed vehicle can satisfy more than one departure at once: the operator publishes nothing tying a vehicle to a particular departure, so the interface reports what was seen rather than inventing an allocation. A position match is evidence, not a booking. It says the operator reported one vehicle of that route at a stop on this leg while the leg was running; it does not prove that vehicle will carry any particular passenger, and a service change after the observation is not reflected. A leg that has already finished, or is more than two hours away, keeps its existing unavailable verdict rather than borrowing a current observation.

Suggested articles: [vehicle assignment](assignment.md), [live vehicle sources](README.md).
