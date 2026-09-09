# Roadmap

## September 9 recovery increments

- [x] Deploy and capture the electric preference controls. Real 390 px and 1440 px light/dark interactions verified Off/Prefer/Avoid, persistence and tracker filtering on the deployed recovery build.
- [ ] Complete Catch mixed-mode controls and validate a real positive interception. The client now accepts a journey without a walking alias, forwards step-free preferences, labels position-aligned estimates, pauses updates, refuses stale/imprecise locations and expires missed transit departures. Local checks pass; the newest client is not deployed or browser-verified.
- [ ] Resolve the appearance inspector context-menu path, verify export without losing the browser app page, and establish real fill-layer editing/order evidence. The initial appearance audit found these open issues; basic persistence, seed, fonts, presets and invalid import retention passed.
- [ ] Complete group creation, collapse/colour controls, bulk-close confirmation and School-mode tab restoration in the deployed interface. Docking, orientation-aware keyboard actions, pinned protection and close/reopen passed.
- [ ] Complete the recovered live-time, appearance-foundation, tabbed-navigation, and vehicle-catching lanes, preserving each original recovery copy.

The complete owner-requested scope is preserved in [PLAN.md](PLAN.md). Unchecked items may contain implemented code, but remain unchecked until their visible behavior and deployment are verified.

## Current delivery priorities

- [x] Show the stops still ahead with published minutes and answer whether the rider has arrived. Verified on the deployed build.
- [x] Mark a leg running through a confirmed closure, with official shuttle text and an explicit statement when none is published.
- [x] Add race rooms with a subway speed run and photo proof. Driven end to end on the deployed build.
- [x] Report the private routing and map origins on their own readiness route, so an outage is not found by a rider.
- [x] Raise fleet manufacturer coverage from 85% to 99% across every agency from published rosters.
- [ ] Resume the September 6 handoff at the top of HANDOFF.md. The race planner now covers rooms, teams, endpoints, real routes, the draw and check-ins; the ordered meetup locations of slice 2 remain unbuilt.
- [x] Draw a route for every team from real itineraries between a chosen start and finish, preferring distinct journeys and disclosing a shortfall, with a wheel whose reduced-motion path reaches the same draw.
- [x] Tie a departure to the vehicle finishing the previous trip on its own block, disclosing the block, the method and the same-route-only limit of the block search.
- [x] Plan the alternative trains a GO cancellation names, from the operator's own published wording, and say plainly where the timetable cannot confirm one.
- [x] Add a journey smoke test across Toronto and the wider region, distinguishing a real timetable gap from a planner failure.
- [x] Integrate or retire every outstanding branch and reduce the repository to one `main` locally and remotely, after archiving it.
- [ ] Verify the block chain and the GO cancellation planner in the built interface with real captures. The race draw is captured; the block-chained vehicle card is not, because the planner combobox resisted three scripted attempts.
- [x] Wire the dim-sum release code name and photo into the release workflow. It had never been wired at all rather than being exhausted; v0.1.0-96.1 is the first release to carry one.
- [x] Fix the Metrolinx feeds. The credential was never the problem: the GO paths were missing `.proto`
      and answered 200 with JSON, and the credential file was unreadable to a container that drops every
      capability. GO now reports 39 alerts and 123 live vehicles, UP is live.
- [x] Narrow the alerts shown beside a journey leg. Station facility notices now appear only where the leg calls at that station, service and facility notices are labelled distinctly, and every match renders. Verified on the deployed build at 9b4b8a2 with a real Line 5 journey.
- [x] Show the declared GO super express badge on branches 12B, 16, 25C, 47D, 56A and 88C. Verified on the deployed build at bad8a32 with real 12B and 16 journeys, a TTC negative control, and 320px light and dark measurements. The route picker and tracker do not carry it yet.
- [x] Identify a bus by position when the operator publishes no matching trip identifier, and name the closest vehicle before a departure starts. Verified on the deployed build across ten corridors. The measured cause is recorded in docs/vehicles/trip-identifiers.md.
- [ ] Complete closure/shuttle integration, exact bus assignment mapping and the remaining rendered verification. Preserve the distinction between deployed code and verified behavior.

- [ ] Verify follower next-stop name resolution in the built interface after agency-qualified ID matching and exact stop lookup. Nine local identity/progress tests pass.
- [x] Refresh the TTC garage source when a new official summary is published. Refreshed to the September 6 to October 31, 2026 summary, read from the document's three route lists with four routes settled against their own entries. 249 route assignments, up from 207, and three fleet allocation changes. Answers outside the period come from the last published summary rather than refusing, on every surface including the journey preference, and each says which period it describes. `node scripts/check-ttc-summary.mjs` reports when a newer one is posted.

- [ ] Verify contextual suggestion cards on the built interface: exact timetable routes, explicitly nearby routes, place-specific type/address fields and washroom presence. Warden source mismatch is repaired without changing destination identity; broader address enrichment remains source-dependent.

- [ ] Complete all-agency unit-level fleet research. Added 72 sourced series across MiWay, Brampton, Durham and YRT, including prefixed electric identities. Current membership, missing agencies, standing capacity and licensed exact-unit photos remain explicit gaps in docs/vehicles/regional-research.md.

- [ ] Deploy and verify the dedicated vehicle-preference dialog: staged Apply/Cancel, exclusive Off/Prefer/Avoid, independent manufacturer/model searches, visible unknown-assignment handling and guided narrow sections. Local behavior checks pass; rendered verification remains pending.
- [x] Exercise the committed timestamped capture helper against the built interface. The canonical target verifier it spawns was never committed; it is now, and the first capture passes version-1 validation and is promoted.

- [ ] Finish the journey-time public evidence record. At 9391cba, native field clearing, blocked invalid submissions, both presets and a real 30-minute request shift passed. Twelve clock/calendar helper tests and the full 178-test local suite passed. The stable effect dependency is corrected; capture promotion is blocked by an absent actual capture timestamp and incomplete owned browser teardown.
- [ ] Complete evidence promotion for the reverse-trip control. Actual 390/320px light/dark and 320px bilingual checks at 9391cba found no overlap with Union's full selected name. The raw images remain private because their required timestamp and cleanup proof are incomplete. Physical touch and the broader matrix remain unverified.

- [x] Deploy and verify four settings sections, guided theme/language choices, independent tone sliders and exact-setting search with isolated regex workbenches. Persistence and keyboard paths passed; the correction run at 1e428b1 passed five version-1 browser audits. Broader language/zoom coverage remains open.
- [x] Deploy and verify the guided route picker: separate phone steps, agency counts, focused search, official badges, period handling and non-submitting picker actions. The nested-form radio correction was verified separately at b7e0ae4 with zero incidental planning requests.
- [x] Deploy compact star controls and verify their actual 44px geometry, open/close, focus return and narrow layout at 5482814.
- [x] Verify saved-snippet persistence with a complete keyboard activation sequence and ordinary pointer click at 34f6fff. Both saved entries survived reload; the earlier synthetic Enter did not establish product failure.
- [x] Deliver and verify the full workspace redesign across planning, tracking, status, history, saved trips, coverage, settings and mobile More navigation. Driven in the built artifact at 92153d6 across all ten surfaces, at 1440 and 390 in both themes, 56 steps per tuple with a capture after every click and no console exceptions. More opens and closes at 390; the rail reaches its secondary destinations at 1440.
- [ ] Deploy and exercise manufacturer/model/year tracker filters, per-field search workbenches and the exact-assignment out-of-division planning preference. Local matching, freshness and HTTP-boundary tests pass; built-browser proof is pending.

- [ ] Finish the remaining built-browser checks: live vehicle switching and saved/shared destination order. At 1e428b1, actual stop badges, arrow and pointer-drag reordering, matching map labels and a four-stop real journey passed. Physical touch and broader scale coverage remain unverified.

- [x] Ship and verify the dedicated Out-of-division tab, route/classification filters, garage evidence, map and observed rarity. Driven at 92153d6: the four classification filters carry live counts, a selected vehicle states where it lives and which garages run its route, the route badge carries the operator colour, and the map draws each vehicle in it. The allocation source and its end date are named on the surface.
- [ ] Deploy the company-first vehicle preference panel: manufacturer selection controls available models and clears incompatible choices.
- [x] Modernize the route picker, vehicle preference controls and overall visual hierarchy, then verify phone-width light/dark layouts. The 390px light and dark tuples are green at 92153d6, 55 of 56 steps with the remaining one scoped to the desktop rail.
- [x] Deploy and interact with the agency/route dialog, official colors and isolated regex workbenches. Phone steps and desktop columns were exercised; the broader language/zoom matrix remains open.
- [ ] Verify compact location queries against deployed services and show served routes/colors on stop suggestions.
- [ ] Add location clear buttons and ordered multi-destination planning, drag reordering, keyboard reordering and saved/shared order.
- [ ] Add Less transfer waiting, explicitly allowing longer rides in exchange for shorter platform waits.
- [ ] Finish full live follower verification. Trip simulation, next-stop advancement, washroom review and close-focus behavior are deployed and browser-verified; physical GPS and live vehicle switching remain unverified.
- [ ] Continue official washroom coverage research. 32 facilities are deployed, including nine Toronto library branches with published hours and dated exceptions; missing agency and community-centre records remain explicit gaps.
- [ ] Show washrooms throughout planning and add urgent washroom diversion with ETA and retained remaining destinations.
- [x] Deploy required-line selection and verify an actual Line 5 detour in the public API and built browser, preserving the extra Bloor-Yonge destination. Other selectable routes use the same exact-identity contract; availability remains bounded by published data.
- [ ] Expand live route-by-route checks beyond Line 5 and promote validated public captures of the new flows.
- [x] Give notifications a stacking surface, per-severity dismissal and a reviewable centre, with bulk actions, eleven export formats and a two-key gate in front of the irreversible one. Driven in the built artifact, 24 checks.
- [ ] Separate bus, streetcar, rapid-transit, network-wide and unclassified disruption groups.
- [ ] Repair evidenced assignment joins and document the route-324 static/live identifier mismatch without inventing a vehicle.
- [x] Deploy narrator enable/voice/rate/quiet controls and verify persistence through real browser interaction. Physical audio was not tested.
- [ ] Remove or block edge-injected analytics and rerun the strict delivered-page network audit.
- [ ] Keep PLAN.md, ROADMAP.md, HANDOFF.md and the public progress record synchronized with each verified delivery.

## First complete regional release

- [x] Create a public source repository and agreed deployment architecture.
- [x] Implement and test official TTC alert decoding and conservative fallback.
- [x] Test Toronto daylight-saving conversion and saved coordinate validation.
- [ ] Complete and verify every passenger flow in the built browser interface.
- [x] Build and serve a graph from all eleven validated agency feeds.
- [x] Generate local map tiles and address/place search from real regional data.
- [ ] Verify representative local and cross-agency journeys against the running engine.
- [ ] Deploy the frontend and private backend services with rollback evidence.
- [x] Owner configures the public DNS and tunnel hostname.
- [x] Retain disruption history indefinitely with calendar filtering and exports.
- [x] Make journey and per-leg ride times and kilometres prominent.
- [x] Prefer confirmed transit-facility presence at boarding/alighting points, keeping unknown hours explicit. Official municipal facilities are also valid for urgent diversions when their published hours confirm arrival-time availability.
- [x] Complete intersection-aware search, including Warden and Highway 7.
- [x] Add live vehicle maps for six connected agencies and exact-trip assignments.
- [x] Show verified fleet details, CPTDB references and attributed photos where available.
- [ ] Connect every available official real-time feed, documenting inaccessible sources. York Region Transit vehicles are connected; its realtime is published from a different host than its timetable, which is why the schedule was current while the buses were absent. Remaining agencies are still to be surveyed.
- [ ] Verify the public HTTPS hostname and published release.

## Later capabilities

- [ ] Broader real-time journey updates as compatible official feeds are verified.
- [ ] Auditable fare estimates and fare-rule coverage.
- [ ] Specialized/on-demand booking integrations if authorized.

- [x] Deploy shared exact/representative photo captions and licence links; verify tracker rendering at 320px and desktop widths.
- [ ] Exercise the updated caption on a live assigned-vehicle directions flow and promote validated public gallery evidence.

- [ ] Verify deployment of the attribution-corrected TTC 3539 photo and rejection of the removed URL.

## Planner reliability follow-up

- [ ] Complete partial-name and intersection suggestions across abbreviations and word order, including real browser verification.
- [ ] Provide agency and route selection with official colors and an adjacent advanced regex builder for each search.
- [ ] Deploy and verify the all-agency tracker, paginated list, map summaries and automatic detail focus.
- [ ] Show first-service and transfer waiting time for each returned journey option.
- [ ] Add verified manufacturer, model and build-year preference and avoidance controls.
- [x] Add dated out-of-division classification and observed-frequency rarity without invented probabilities. Rarity is stated as a share of observed days with its sample beside it, needs at least seven observed days, and says on the surface that it is not a prediction. Classification carries the date its allocation source covers.
- [ ] Separate seated, standing and total capacity when supported by sources.
- [ ] Add an opt-in narrator with separate English and Cantonese voices and serialized announcements.
- [x] Add the dim sum surprise: a one-in-ten dish at launch, named in both languages, with photos fetched from the public catalog into a gitignored directory and downscaled for serving. No setting, because what makes it polite is that it costs nothing.
- [x] Add comfort modes and a local personal-vocabulary file. Five independent accommodations, all off by default and named for what they do, plus a bounded local JSON wording file that ships with nothing of its own.
- [ ] Add planner-relevant accessibility, command search, appearance, notification history, saved-trip history, exports and help features. Ollama and file conversion are excluded. Command search has shipped: Ctrl+Shift+F reaches every destination, every setting and three actions, with settings rows carrying their real controls and a teleport that lands on the exact element. Driven in the built artifact, 15 of 15 checks, and captured in both themes at 1440. It is still absent from the interaction ledger, which needs a deploy first. Appearance, notification history, saved-trip history, exports and help remain unbuilt.

- [x] Include the UP Express airport station in public Pearson search results.
- [x] Return neutral empty journey results without coordinate-based agency attribution.
- [x] Preserve distinct same-name stop locations and sort next coverage dates.
- [x] Version map tiles by the actual dataset revision, verified on both live map surfaces.
- [x] Improve map road detail by zoom, preserve full tile coverage, and validate the published dataset.
- [ ] Obtain consistent replacement photos for TTC XDE60 and HSR.
