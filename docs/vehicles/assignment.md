# Journey vehicle assignment

## Contract

`enrichItineraries()` attaches a live vehicle only when the journey leg and a fresh vehicle-position entity have the same agency and the same normalized GTFS trip identifier. It never assigns a vehicle from a shared route, headsign, position, or timetable proximity alone.

The matcher accepts ISO-8601 journey times and Unix epoch values in either seconds or milliseconds. It refuses malformed time ranges, journeys more than two hours ahead, and journeys that ended more than two minutes ago. Those checks prevent a current observation from being attached to a future or completed journey when a trip identifier is reused.

The public TTC feed name is `ttc`. The planner can legitimately return schedule-version identifiers such as `ttc-next:...`; the matcher maps the known `ttc-next` alias to the public TTC feed and removes only a recognized TTC feed prefix before comparing the remaining trip identifiers. It does not remove arbitrary prefixes or fall back to route matching.

## Observed TTC boundary

On 2026-09-05, the public planner returned the southbound 324 journey from Warden Avenue at Steeles Avenue East to Victoria Park Avenue at Eglinton Avenue East with static trip identifier `ttc:50677154`. A fresh TTC vehicle-position snapshot at `2026-09-05T06:59:52.355Z` reported route 324 vehicles with live trip identifiers including `32056020`, `62269020`, and `112450020`. None was the planned static identifier.

The TTC vehicle-position and trip-update entities observed for those active route 324 records omitted `TripDescriptor.start_time`, `TripDescriptor.start_date`, and `TripDescriptor.direction_id`. The publisher therefore did not provide a verifiable key that relates the planned static trip to a live trip identifier. The result remains `no-match`, not a guessed vehicle.

## Safe future extension

An exact assignment can be extended only when a publisher supplies a stable, documented mapping between the planner's static trip identifier and the live descriptor, or when both sources expose matching trip, service-date, start-time, and direction fields. Any extension must keep the current time-window checks and require every available field to agree. Route number, destination text, or a nearby vehicle remain insufficient evidence.

## Sources and verification

- [TTC GTFS Realtime vehicle positions](https://bustime.ttc.ca/gtfsrt/vehicles)
- [TTC GTFS Realtime trip updates](https://bustime.ttc.ca/gtfsrt/trips)
- [OpenTripPlanner `planConnection` reference](https://docs.opentripplanner.org/api/dev-2.x/graphql-gtfs/queries/planConnection)

The focused vehicle tests cover exact matching, TTC schedule-version aliases, ISO and Unix timestamp forms, the observed static/live trip mismatch, and prevention of future or completed journey assignments.
