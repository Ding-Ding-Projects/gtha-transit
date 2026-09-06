# Following the vehicle from its previous trip

A tracker normally carries a vehicle from the trip it is finishing into the trip
you are about to board. That chain is what tells a rider which bus is coming, and
it is built here from the timetable's own `block_id`.

## What a block is, and why it is the strongest tie available

A block identifier is the publisher's own statement that **one vehicle runs a
named sequence of trips in order**. It is the only published link between a
vehicle and a departure this operator offers.

It matters because the realtime identifiers do not join. Measured against the live
TTC feeds on 6 September 2026: of 406 trip identifiers in the realtime vehicle
feed, 104 also existed in the loaded timetable but only one carried the same route,
and of 192 vehicles whose reported stop identifier existed in the timetable, not
one was within 300 metres of that timetable's stop. Both identifier spaces are
number collisions. The block is not: it is published on the trips themselves.

## How the previous trip is found

Three queries against the routing engine, for a leg that has not departed yet:

1. the leg's trip, for its `blockId`;
2. every trip on the leg's route, for those sharing that block and running today;
3. the stop times of the trip immediately before this one in departure order.

Only trips whose `activeDates` include today's **Toronto** service date are
ordered, so a block that also exists tomorrow does not push the wrong trip into
first place.

At most four legs in one plan ask for a block chain, because each one is three
queries and a plan with ten itineraries would otherwise make thirty.

## How the vehicle is then identified

Two ways, and the interface says which was used.

- **`block-predecessor-trip-id`** — a fresh vehicle publishes the previous trip's
  own identifier on the leg's route. Strongest, and rare on this operator.
- **`block-predecessor-position`** — the previous trip is placed by its published
  stop times, and exactly one fresh vehicle on that route is within 150 metres of
  where that trip should be at this moment.

Exactly one candidate, or nothing is claimed. Two vehicles at the previous trip's
expected position identify none, and a vehicle elsewhere along that trip is not
where the trip should be now and does not qualify. Route equality alone never
assigns a vehicle, here as everywhere else.

## What it does not claim

The chain says the timetable puts this departure and the trip before it on the
same vehicle, and that this vehicle is the one running that earlier trip now. It
is not a booking. A service change after the observation is not reflected, and a
vehicle swapped mid-block is not something the operator publishes.

## The limitation, stated rather than hidden

The routing engine offers no query for trips by block — only by route. So the
search runs within the leg's own route, and the result records
`scope: "same-route-only"`.

A block that changes route mid-day therefore has a predecessor this cannot see. In
that case the leg reports honestly that it has not started, with the reason:
`no-block-published`, `trip-not-on-block-today`, `first-trip-of-the-block` or
`no-published-times-for-previous-trip`. It falls back to naming the closest vehicle
on the route with its measured distance, which is a measurement and not an
assignment.

Suggested articles: [identifying the vehicle on a leg](trip-identifiers.md),
[vehicle assignment](assignment.md).
