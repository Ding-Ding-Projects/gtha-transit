# Choosing where the race runs, and drawing a route for each team

A race needs three things before anyone can run it: a start, a finish, and a route
for every team. This article covers all three, and the one honesty rule that runs
through them.

## The start and the finish

The leader picks both through the same published place search the journey planner
uses, so a race endpoint is a real station, stop or address with published
coordinates. There is no free-text endpoint: a place that cannot be found cannot
be planned to, and offering it would produce a race nobody can route.

Everyone races between the same two places at the same departure time. That time
is a Toronto wall-clock time and is resolved through the planner's own timezone
code, so a race set for the hour the clocks move is refused in the same words the
planner refuses it.

## The routes are real, or there are none

`Find the routes` asks the routing API for itineraries between those two places at
that time. Every route a team can be drawn is one of those itineraries. Nothing is
composed, padded or invented to make the draw come out even.

Two itineraries that ride the same lines in the same order are one route. A racer
does not experience two departures four minutes apart on Line 1 as a different
route, so treating them as distinct would produce a draw that looks varied and is
not. The signature is the ordered list of lines ridden; departure time is
deliberately not part of it.

## The draw

Distinct routes are dealt first, in a shuffled order, one per team. Only when the
distinct routes run out does a team receive one another team already has.

**A shortfall is counted and shown.** If the timetable offers two genuinely
different journeys for four teams, the interface says that two teams are riding a
route another team also has, and that this is a real shortage of routes rather
than a pairing chosen for them. It is never left to look deliberate.

## The wheel is decoration, and never the only way to read the result

The wheel spins because a draw should feel like one. The result is written out
underneath it every time, team by team, with the lines, the journey time and the
number of transfers.

Somebody who has asked their system for reduced motion gets the same draw with no
spin at all, announced through a live region rather than watched. The two paths
reach the identical assignment: the draw is computed first and the animation, if
any, runs over the top of a result that is already decided.

## What a drawn route is, and is not

It is a real itinerary from the published timetable at the moment of the draw. It
is not a reservation, and it does not update itself: a cancellation or a diversion
after the draw is not reflected in what a team was given. Teams ride the network
as it is on the day, and the drawn route is the journey they were asked to try.

Suggested articles: [race rooms](README.md), [the speed run](speed-run.md),
[cancellations and the trains offered instead](../planning/go-cancellations.md).
