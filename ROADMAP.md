# Roadmap

The complete owner-requested scope is preserved in [PLAN.md](PLAN.md). Unchecked items may contain implemented code, but remain unchecked until their visible behavior and deployment are verified.

## Current delivery priorities

- [ ] Verify contextual suggestion cards on the built interface: exact timetable routes, explicitly nearby routes, place-specific type/address fields and washroom presence. Warden source mismatch is repaired without changing destination identity; broader address enrichment remains source-dependent.

- [ ] Complete all-agency unit-level fleet research. Added 72 sourced series across MiWay, Brampton, Durham and YRT, including prefixed electric identities. Current membership, missing agencies, standing capacity and licensed exact-unit photos remain explicit gaps in docs/vehicles/regional-research.md.

- [ ] Deploy and verify the dedicated vehicle-preference dialog: staged Apply/Cancel, exclusive Off/Prefer/Avoid, independent manufacturer/model searches, visible unknown-assignment handling and guided narrow sections. Local behavior checks pass; rendered verification remains pending.
- [ ] Exercise the committed timestamped capture helper against the built interface. Its 29 consistency/privacy tests pass, but mock transport tests are not browser evidence.

- [ ] Finish the journey-time public evidence record. At 9391cba, native field clearing, blocked invalid submissions, both presets and a real 30-minute request shift passed. Twelve clock/calendar helper tests and the full 178-test local suite passed. The stable effect dependency is corrected; capture promotion is blocked by an absent actual capture timestamp and incomplete owned browser teardown.
- [ ] Complete evidence promotion for the reverse-trip control. Actual 390/320px light/dark and 320px bilingual checks at 9391cba found no overlap with Union's full selected name. The raw images remain private because their required timestamp and cleanup proof are incomplete. Physical touch and the broader matrix remain unverified.

- [x] Deploy and verify four settings sections, guided theme/language choices, independent tone sliders and exact-setting search with isolated regex workbenches. Persistence and keyboard paths passed; the correction run at 1e428b1 passed five version-1 browser audits. Broader language/zoom coverage remains open.
- [x] Deploy and verify the guided route picker: separate phone steps, agency counts, focused search, official badges, period handling and non-submitting picker actions. The nested-form radio correction was verified separately at b7e0ae4 with zero incidental planning requests.
- [x] Deploy compact star controls and verify their actual 44px geometry, open/close, focus return and narrow layout at 5482814.
- [x] Verify saved-snippet persistence with a complete keyboard activation sequence and ordinary pointer click at 34f6fff. Both saved entries survived reload; the earlier synthetic Enter did not establish product failure.
- [ ] Deliver and verify the full workspace redesign across planning, tracking, status, history, saved trips, coverage, settings and mobile More navigation.
- [ ] Deploy and exercise manufacturer/model/year tracker filters, per-field search workbenches and the exact-assignment out-of-division planning preference. Local matching, freshness and HTTP-boundary tests pass; built-browser proof is pending.

- [ ] Finish the remaining built-browser checks: live vehicle switching and saved/shared destination order. At 1e428b1, actual stop badges, arrow and pointer-drag reordering, matching map labels and a four-stop real journey passed. Physical touch and broader scale coverage remain unverified.

- [ ] Ship and verify the dedicated Out-of-division tab, route/classification filters, garage evidence, map and observed rarity. Server and history modules are implemented.
- [ ] Deploy the company-first vehicle preference panel: manufacturer selection controls available models and clears incompatible choices.
- [ ] Modernize the route picker, vehicle preference controls and overall visual hierarchy, then verify phone-width light/dark layouts.
- [x] Deploy and interact with the agency/route dialog, official colors and isolated regex workbenches. Phone steps and desktop columns were exercised; the broader language/zoom matrix remains open.
- [ ] Verify compact location queries against deployed services and show served routes/colors on stop suggestions.
- [ ] Add location clear buttons and ordered multi-destination planning, drag reordering, keyboard reordering and saved/shared order.
- [ ] Add Less transfer waiting, explicitly allowing longer rides in exchange for shorter platform waits.
- [ ] Finish full live follower verification. Trip simulation, next-stop advancement, washroom review and close-focus behavior are deployed and browser-verified; physical GPS and live vehicle switching remain unverified.
- [ ] Continue official washroom coverage research. 32 facilities are deployed, including nine Toronto library branches with published hours and dated exceptions; missing agency and community-centre records remain explicit gaps.
- [ ] Show washrooms throughout planning and add urgent washroom diversion with ETA and retained remaining destinations.
- [x] Deploy required-line selection and verify an actual Line 5 detour in the public API and built browser, preserving the extra Bloor-Yonge destination. Other selectable routes use the same exact-identity contract; availability remains bounded by published data.
- [ ] Expand live route-by-route checks beyond Line 5 and promote validated public captures of the new flows.
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
- [ ] Connect every available official real-time feed, documenting inaccessible sources.
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
- [ ] Add dated out-of-division classification and observed-frequency rarity without invented probabilities.
- [ ] Separate seated, standing and total capacity when supported by sources.
- [ ] Add an opt-in narrator with separate English and Cantonese voices and serialized announcements.
- [ ] Add planner-relevant accessibility, command search, appearance, notification history, saved-trip history, exports and help features. Ollama and file conversion are excluded.

- [x] Include the UP Express airport station in public Pearson search results.
- [x] Return neutral empty journey results without coordinate-based agency attribution.
- [x] Preserve distinct same-name stop locations and sort next coverage dates.
- [x] Version map tiles by the actual dataset revision, verified on both live map surfaces.
- [x] Improve map road detail by zoom, preserve full tile coverage, and validate the published dataset.
- [ ] Obtain consistent replacement photos for TTC XDE60 and HSR.
