# GO cancellations, and the trains offered instead

When Metrolinx cancels a train, the alert does not only say so. It names the trains
a rider can take instead, in a fixed published form:

```
Train cancelled - Aurora GO 16:55 - Union Station 17:46

The Aurora GO 16:55 - Union Station 17:46 train has been cancelled due to crew
constraints.

Please consider the following train options:

By GO train: Aurora GO 15:55 - Union Station 16:46
By GO train: Allandale Waterfront GO 17:05 - Union Station 18:46
```

Reading that is one thing. Being able to travel on one of them is another, so each
named alternative is looked up in the real timetable and shown as a journey.

## Where the alerts come from

Metrolinx publishes GO and UP service alerts as an ordinary GTFS-Realtime alert
feed behind an API key. That key lives on the routing service and never reaches a
browser, so the feed is read through it and decoded with the same decoder the TTC
alert feed uses.

Without the routing service configured there is no feed at all. That is reported
as **unavailable**, never as an empty list: an empty list and a silent feed look
identical on screen and mean opposite things.

## What is parsed, and what is not

A line becomes a plannable journey only when it matches the published form
exactly: an origin, a 24-hour time, a separator, a destination, a 24-hour time.
Anything else is kept as the operator's own text with no journey attached.

That strictness is the point. A station name guessed out of a line that does not
match would send a rider to the wrong platform, which is worse than offering no
alternative at all. So a bus option written as prose, or a line with a missing
time, appears exactly as published and is labelled as not being in the station and
time form.

The subscription footer that ends every GO alert is not an option and is not read
as one. A repeated option is listed once. The cancelled trip itself is named
separately from the alternatives and is never offered as one.

## Putting a published time on a day

The published times are Toronto wall-clock times with no date, so they are placed
on the alert's own service date — the Toronto calendar day of its active window,
not the UTC one, which differs for any alert issued after 20:00 local.

An arrival earlier than its departure has crossed midnight and belongs to the next
day. Nothing else is adjusted. A time that does not exist on that date, because the
clocks moved forward, is left unresolved rather than moved to a time the operator
never published, and no journey is looked up for it.

The rules for turning a Toronto wall time into an instant are the journey planner's
own and are passed in rather than copied, so there is exactly one owner of them.

## What the planned journey claims

Each alternative is planned from the loaded timetable between the two named
stations at the published departure time, and the result is shown as the lines
ridden and the journey time. At most six alternatives are planned at once, so one
alert cannot spend the routing service.

Where the timetable does not confirm a journey, that is said plainly: the operator
published the option and our loaded timetable did not confirm it, so ride it on
the operator's word rather than ours. The alert is the source; the plan is only
our reading of it, and the two are never merged into one claim.

Suggested articles: [closures and shuttles](closures-and-shuttles.md),
[alerts on a leg](../status/leg-alerts.md).
