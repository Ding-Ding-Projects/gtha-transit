# Planning a journey

Use the separate [travel date and time controls](travel-time.md) to select departure or arrival time in Toronto's timezone.

Choose an origin and destination from search results, or select a map position. Enter a date and time in Toronto local time and choose departure or arrival planning. The journey result shows each boarding stop, direction, transfer and walking leg.

The repeated local hour when daylight saving ends selects its earlier occurrence. A nonexistent local time during the spring clock change is rejected. Times are never interpreted in the visitor's device timezone.

Save a trip for later use, then plan again before travelling so current schedules are used. A share link contains every selected place in order, the selected travel time, ranking preference and required route when chosen. JSON exports include journey details and available data provenance. Clearing browser storage clears saved trips and preferences.

Add up to five intermediate destinations before the final destination. Drag a row handle or use its up/down buttons to reorder it. Clearing a field retains the row until it is filled or removed. The map labels match the visible destination numbers, including gaps while a field is empty. Planning rejects incomplete rows and returns only a complete itinerary visiting every requested point in order.

The Less transfer waiting preference favors shorter platform waits even when a ride takes longer. All ride, walk, waiting and total elapsed times remain visible. Stop suggestions show official route colors where published. Selected-stop details are tied to the selected timetable date and distinguish schedule routes from live arrivals. Official washroom presence appears beside matched boarding, alighting and intermediate stops. Unknown hours never become an open claim.

Journey preferences also offer a Line 5 shortcut and a dated agency/route picker for a required ride. See [required lines](required-line.md) for bounded search limitations. Open [live following](live-follower.md) from a journey or a selected tracked vehicle. The interface changes are implemented; current built-browser and production verification is recorded in the handoff rather than implied by this article.

No result can mean missing data, a service-calendar boundary, an inaccessible connection or no available service. Check coverage and official agency notices. Live TTC notices are separate from scheduled routing and do not guarantee automatic rerouting.

The September 5, 2026 timetable uses the TTC publisher archive retrieved by MobilityDatabase on July 14, 2026. Its SHA-1 is `e16989d2f20c3a20b7d2acbe5154292f675d1232` and its SHA-256 is `6a2597e02c81c1c51734b3773d9b8cd62a09395362ffbead536c5b97289ac89c`. The next official TTC timetable is loaded as a separate graph feed for service beginning September 6. Both graph feeds are presented as TTC in public coverage and journey responses. Archived bytes remain unchanged, and live updates are enabled only when their trip identifiers match the active schedule snapshot.

Suggested articles: [TTC status](../status/README.md), [regional data](../data/README.md), [deployment](../deployment/README.md).

Each journey option shows its first boarding time, initial waiting from the chosen departure time with access walking excluded, transfer waiting, and total elapsed time to arrival. Each transit leg identifies its own boarding wait. Arrive-by planning does not invent an initial departure wait. Invalid or overlapping connection times are unavailable rather than a false zero. These values describe the returned itinerary; they do not claim every later departure is represented.
