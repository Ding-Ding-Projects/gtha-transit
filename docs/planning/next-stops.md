# Stops ahead, and are we there yet

While following a trip, the follower shows the stops still to come with the minutes to each, and answers the one question a rider actually asks.

## Where the minutes come from

The routing service now asks the routing engine for each intermediate stop's own `arrival` and `departure` times and passes them through unchanged. A stop reports its **live estimate** when the publisher supplied one and its **timetable** time otherwise, and each row says which it used. The boarding and alighting times are the leg's own published times.

**Nothing is interpolated.** A stop the publisher gave no time for is listed with `No published time` rather than a figure derived from its neighbours. A guessed arrival is worse than an admitted gap, because a rider cannot tell the two apart.

## Are we there yet

The answer is drawn from what is known, in this order:

- **Yes** — the device's own position is within 250 metres of the alighting stop, or the follower has reached it in the stop sequence.
- **Nearly** — one stop remains, or the published arrival is two minutes away or less.
- **Not yet** — stops or minutes remain, and the panel says how many of each.
- **It cannot be told** — no position is shared and the publisher gave no arrival time. The panel says exactly that rather than guessing.

The note beneath states whether the answer used a measured distance from the device or the published stop times alone. This is not a live arrival prediction, and it never claims a vehicle is at a stop that the publisher has not reported.

## Limits

Times are as good as the feed. Where an agency publishes no real-time estimate, every figure is the timetable's, and a delayed vehicle will not be reflected. The measured distance appears only while the rider has location sharing on; it is never derived from a vehicle position that the passenger is only assumed to be on.

Suggested articles: [live follower](live-follower.md), [passenger guide](README.md).
