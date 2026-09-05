# GTHA Transit delivery plan

This is the durable scope record for the owner's transit-planner requests. It is updated during implementation. A checked item means the stated outcome was verified, not merely that code was written. See [ROADMAP.md](ROADMAP.md) for delivery tracking and [HANDOFF.md](HANDOFF.md) for operational evidence.

## Product and deployment

- Build an independent browser-based replacement for Triplinx across Greater Toronto and Hamilton.
- Publish at https://toronto-transit.org/ through the owner-managed tunnel, with a private LAN fallback.
- Keep Docker deployment, source commits, remote verification and rollback records current. Private infrastructure and credentials never enter this repository.
- Deploy independently completed changes frequently. Keep unfinished work and external-data gaps explicit.
- Preserve official feed provenance, licenses, retrieval times, checksums and service-calendar coverage. Never invent schedules, coordinates or live coverage.

## Priority 1: dependable and understandable planning

- [x] Restore current-date Toronto routing with validated adjacent TTC timetable versions.
- [ ] Finish broad reproducible Toronto and cross-region smoke coverage, including varied real locations and service times.
- [ ] Complete partial location suggestions, abbreviations, intersections, diacritics, reversed order and compact forms such as `Highway7Warden`, with live verification.
- [ ] Show serving routes and official route colors in stop suggestions and on the selected stop. Distinguish scheduled service from live arrivals.
- [ ] Add a clear button to each location field, clearing both its selected place and typed text.
- [ ] Support up to five ordered intermediate destinations through the real routing engine, preserving all requested stops and chronological validity.
- [ ] Allow destinations to be dragged into a new order, with keyboard and touch-accessible move-up/move-down controls.
- [ ] Preserve destinations and order in saved trips, explicit share links, exports and reverse-trip behavior.
- [x] Make ride duration, walking distance and kilometres prominent.
- [x] Display first-service and transfer waiting time on returned journey options and legs. Real browser evidence exists for a 02:00 Toronto journey; this does not imply exhaustive next-departure coverage.
- [ ] Add Less transfer waiting, favoring less platform waiting even when the ride is longer, while showing the tradeoff.
- [ ] Provide useful departure alternatives with their individual waits. Do not claim every possible departure was searched.

## Priority 2: vehicle-aware journeys and tracking

- [x] Display reported vehicles from all six currently connected agencies together by default; paginate the list without paginating the loaded map.
- [x] Show an embedded marker summary and let More details reveal and focus the corresponding full vehicle record.
- [x] Automatically reveal details after a list selection at phone width.
- [ ] Replace the difficult route field with a clear agency-first, route-second dialog, official colors, partial search and independent advanced regex tools.
- [ ] Finish modern, readable, agency-colored vehicle rows and explicit manufacturer/model/build-year filters.
- [ ] Prefer or avoid vehicle manufacturer, model and build-year ranges in planning. The initial controls are deployed; the company-first model cascade is implemented and awaiting deployment/interaction proof.
- [ ] Require company selection before model selection, show only that company's verified models, and clear incompatible selections on a company change.
- [ ] Make unknown vehicle assignments and their effect on avoidance filters explicit and recoverable.
- [ ] Repair every evidenced exact-trip vehicle-assignment join defect. In particular investigate TTC route 324 from Warden/Steeles toward Victoria Park/Eglinton. Current static and live trip identifiers differ; never substitute a bus solely because it shares the route.
- [ ] Show verified assigned vehicle details in directions: manufacturer, model, build year or date when published, unit and attributed photo.
- [ ] Expand verified fleet details/photos across supported agencies, linking CPTDB where appropriate and respecting publisher access restrictions.
- [ ] Label an exact-unit photograph only when its identity is verified; otherwise label it representative. Do not reintroduce withdrawn attribution-conflicted images.
- [ ] Separate seated, standing and total capacity, and distinguish operating/planning limits from maximum capacity. Missing values remain unknown.

## Priority 3: out-of-division vehicles

- [ ] Deploy a dedicated Out-of-division tab with map, list, route selection and classification filters.
- [ ] Show each proven vehicle home garage beside the route's complete assigned garage set.
- [ ] Distinguish out-of-division, in-division and unknown; retain unknown results for expired, ambiguous or missing evidence.
- [ ] Refresh dated official allocation sources. The prepared TTC source expires after September 5, 2026.
- [ ] Retain vehicle/route/day observations indefinitely without retaining GPS coordinates.
- [ ] Display observed-frequency percentage and Omega, Legendary, Epic, Rare, Uncommon or Common labels only after sufficient evidence. The seven-day minimum means rarity is initially unavailable.
- [ ] Add the planning preference to ride routes with a verified out-of-division vehicle. Do not infer future vehicle assignments.

## Priority 4: washrooms throughout the journey

- [x] Provide the initial preference for confirmed transit-facility washrooms.
- [ ] Research missing official station and terminal washroom information across the region.
- [ ] Include official municipal libraries, community centres and similar infrastructure when washroom presence is verified and published hours support arrival-time availability. This explicitly expands the earlier transit-only scope.
- [ ] Keep facility identity and agency distinct, especially TTC Union versus the GO bus terminal. Do not infer a facility from an ambiguous name or nearby street.
- [ ] Show washroom information beside applicable selected locations, boarding points, transfers and journey details.
- [ ] Record sources, retrieval time, facility type, official coordinates where published, hours, timezone, exceptions and accessibility. Unknown is not closed and is not confirmed open.
- [ ] Add I need to use the washroom to the active trip flow: find a reachable confirmed facility, show estimated time to it, reroute and retain remaining destinations.
- [ ] Automatically choose a municipal facility only when it is confirmed open at expected arrival. Unknown holiday exceptions or hours must not silently become open.
- [ ] Explain when an ETA is to the station/terminal rather than the washroom door, and when internal walking or access is unknown.

## Priority 5: chosen-line detours and followers

- [ ] Add Include a line in my trip, starting with TTC Line 5 and extending to other selected agency lines/routes.
- [ ] Require an actual transit leg on the selected line. Merely visiting a station is insufficient.
- [ ] Show the detour and additional time, and report unavailable service or an unsuccessful bounded search honestly.
- [ ] Add a live trip follower with a large next-stop display, upcoming stops, transfer information and journey progress.
- [ ] Add a live vehicle follower with a following map, latest reported position, route and available stop information.
- [ ] Offer explicit Preview/Simulation modes with next/previous controls. A simulation is never labeled live.
- [ ] Use location only after the user's action, keep personal location local, and mark estimated, stale, absent or off-route progress clearly.
- [ ] Stop polling, speech and location watchers when the follower closes or pauses.

## Priority 6: status and history

- [x] Provide live TTC subway and light-rail status with conservative stale/unavailable states.
- [x] Retain disruption history indefinitely, with a calendar picker and exports. Collection began September 4, 2026; earlier history is not fabricated.
- [ ] Separate bus-route and streetcar-route disruptions instead of one Other category; retain rapid-transit, network-wide and unclassified groups.
- [ ] Use official route metadata, including night routes, and deduplicate mixed-route alerts without inflating the overall count.
- [ ] Connect every available official live feed. YRT snapshots are compatible with their supplied static package, but continuous refresh endpoints remain required.

## Priority 7: useful interface and accessibility

- [ ] Replace generic-looking controls with cohesive modern styling, clear hierarchy and responsive layouts, especially route selection and vehicle preferences.
- [ ] Verify phone/tablet layouts, long bilingual labels, both themes, keyboard operation, visible focus and supported display scales. Browser emulation is not physical-device testing.
- [x] Provide English, Cantonese and bilingual presentation, independent playfulness controls and light/dark appearance.
- [x] Deploy an off-by-default narrator with separate English/Cantonese voice choices, preview, rate, pitch and quiet controls. Exact browser enable/selection/reload/disable interaction was verified; no physical-audio claim is made.
- [ ] Add planner-relevant shared UX features: command palette, searchable settings, appearance controls, notification history, saved-trip undo/history, exports, help and changelog.
- [ ] Provide an independent adjacent advanced regex builder for every added search field, keeping plain text the default and evaluation bounded away from the interface thread.
- [ ] Keep saved snippets isolated by search field and preserve focus when an editor closes.
- [ ] Investigate and prevent edge-injected analytics requests found during browser verification. Do not claim no analytics until the delivered page is verified.

## Explicit exclusions and evidence boundaries

- Ollama and file conversion are excluded by the owner.
- Unrelated universal utilities, desktop installers, payment and sign-in features are not part of this browser-transit scope.
- No invented exact vehicles, future assignments, fleet photos, washroom opening hours, rarity probabilities, route colors or schedules.
- No secret material, private infrastructure, downloaded GTFS archives, map databases, dependencies or generated caches in source history.
- A source commit, successful build, release, API result and browser interaction are separate evidence states.
- Keep the plan, roadmap, handoff and public progress record current as requests are implemented or clarified.
