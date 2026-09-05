# Route-level out-of-division opportunities

`annotateJourneyRouteOpportunities(itineraries, snapshot, registry, { now })` adds aggregate route evidence from a fresh live TTC vehicle snapshot. It groups only vehicles already observed as out of division on the exact TTC route and attaches at most 20 vehicle IDs and fleet numbers. It never sets `leg.vehicle` or `vehicleAssignment`, stores no coordinates in the evidence, and never claims an identified departure vehicle or future guarantee.

Only current legs or upcoming boardings within two hours are eligible. Stale snapshots, expired allocation data, ambiguous fleet allocations, missing route evidence, wrong feed identities, and no observed qualifying vehicle remain unknown. `applyJourneyRouteOpportunityPreference(itineraries, { enabled: true })` is an optional stable soft ranking that places currently observed route opportunities first without changing order inside either group.
