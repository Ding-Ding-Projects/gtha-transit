# Route-level out-of-division opportunities

`annotateJourneyRouteOpportunities(itineraries, snapshot, registry, { now })` adds aggregate route evidence from a fresh live TTC vehicle snapshot. It groups only vehicles already observed as out of division on the exact TTC route and attaches at most 20 vehicle IDs and fleet numbers. It never sets `leg.vehicle` or `vehicleAssignment`, stores no coordinates in the evidence, and never claims an identified departure vehicle or future guarantee.

Only current legs or upcoming boardings within two hours are eligible. Stale snapshots, expired allocation data, ambiguous fleet allocations, missing route evidence, wrong feed identities, and no observed qualifying vehicle remain unknown. `applyJourneyRouteOpportunityPreference(itineraries, { enabled: true })` is an optional stable soft ranking that places currently observed route opportunities first without changing order inside either group.

In Vehicle preferences, enable Prefer out-of-division vehicles and choose Current route observations or Exact assigned trip. The route option is the default for a new profile; an already enabled preference from the earlier exact-only version retains exact mode. Settings, saved trips, shared links and JSON exports keep this choice. Changing the evidence mode preserves the selected itinerary.

The web proxy uses its already cached TTC snapshot where available and a one-second bounded lookup otherwise. It adds source-dated, coordinate-free observations after ordinary exact-trip enrichment. Duplicate units use their newest unambiguous route observation. Each of the freshest20 retained identities has an expiry, and the client recalculates the current subset while independently enforcing the Toronto source-validity date. Truncated identity lists say so. The browser-safe ranking module imports no filesystem code.

This is an opportunity to look for a currently observed vehicle on a route. It is not a vehicle assignment for a departure, and no existing assignment is rewritten.
