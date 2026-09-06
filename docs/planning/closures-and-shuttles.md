# Confirmed closures and official shuttles

A journey leg that runs through a confirmed loss of service says so, using the publisher's own words and the publisher's own list of affected stops.

## What counts as confirmed

The TTC route-alert endpoint labels each notice with an effect. Only **No Service** is treated as a closure. A detour, an out-of-service escalator, or a delay is not a closure and keeps its ordinary alert treatment.

Two live examples observed on 6 September 2026:

- `510 Spadina: No service between Queens Quay Loop at Lower Spadina Ave and Union Station Streetcar Platform daily from 9:30 a.m. to 11:59 p.m.`
- `512 St Clair: No service between St Clair West Station at Bay 4 and St Clair Ave West at Oakwood Ave due to a Toronto fire investigation.`

## How a closure reaches a leg

The publisher lists the affected stops itself — eight for the Spadina closure, twenty-two for the St Clair one — and those identifiers resolve exactly against the loaded timetable, checked stop by stop. A closure is attached to a leg only when the leg calls at one of those listed stops, and only when the alert's active window overlaps the leg.

Nothing is inferred. A closure with no listed stops is never attached by route alone, and a closure whose listed stops the leg never calls at does not appear on it. The affected stops of that journey are named on screen, in the publisher's listed order.

## Shuttles

`shuttleType`, `shuttleStart` and `shuttleEnd` are shown verbatim when the TTC publishes them. **No shuttle stop, time, frequency or vehicle is ever derived.** When the TTC has announced no shuttle, the leg says exactly that rather than leaving a reader to assume one exists.

## Limits

Closure handling is currently presentational: a journey through a closed segment is planned as the timetable describes it and then marked, rather than being routed around. Avoidance requires the routing service to exclude the listed stops for the overlapping window and is not yet deployed. The distinction is stated here so nobody reads the notice as proof the route was recalculated.

Other agencies publish their alerts without an equivalent affected-stop list, so this treatment currently reaches TTC services only.

Suggested articles: [alerts beside a journey leg](../status/leg-alerts.md), [passenger guide](README.md).
