# Implementation handoff

## Closeout pass, 6 September 2026

Released `a7bcd200053b0722de8978b092cd1d98d19bd68e` as **v0.1.0-94.1**, non-draft, targeting that
exact commit, with both assets downloadable. Remote CI green
([run 34057308810](https://github.com/Ding-Ding-Projects/gtha-transit/actions/runs/34057308810)).
Deployed and serving publicly. One checkout, one local `main`, one remote `main`.

### Journey smoke test

`node scripts/smoke-journeys.mjs` — fourteen real pairs against the deployed service. Three
consecutive runs after deployment: **13 planned, 1 service gap, 0 failures**. Agencies reached: GO
Transit, TTC, UP Express, York Region Transit. **20-22 legs carried a block chain**, which is a live
count from real plans rather than a fixture.

The one gap is Allandale Waterfront GO to Union Station: the Barrie corridor genuinely has no
Sunday-evening departure, proved by the same pair answering at 09:00 the next weekday. The script
retries before calling anything a failure, because "no route" and "the planner is down" look the
same to a rider and must not look the same here.

### Branches integrated, then retired

- `feature/vehicle-capacity-sources` carried ten source-backed capacity series with tests and docs
  that main did not have. **Merged**, then retired.
- `feature/journey-route-opportunities` had built the same feature main built independently. Not one
  identifier in its module was absent from main's, and main's test file held all four of its tests
  plus two more. Retired by taking main's content unchanged.
- `codex/journey-time-input`, `codex/journey-year-bounds`, `codex/ui-evidence-records` and
  `feature/maps` were already ancestors of `main` with zero unique commits.

All six were proved ancestors of the dewed remote `main` before removal, none was protected, none
was referenced by a workflow, and no pull request was open. The whole repository was archived to
OneDrive first and the archive read back and verified — 697 entries including 337 refs/logs/objects
entries, 4,894,508 bytes — before anything was deleted.

### Gates this repository cannot meet, and why

Stated rather than quietly skipped:

- **Packaged application icon and Squirrel.Windows installer.** This project ships a web service, not
  an installed Windows application. There is no executable to embed an icon in and no installer to
  build. The release artifact is the server bundle.
- **Per-click screenshot ledger across every reachable flow.** Not attempted. The race workspace was
  driven and captured end to end, and the planner's own combobox resisted three scripted attempts, so
  the block-chained vehicle card remains uncaptured.
- **Deep per-surface audit of every canonical feature.** Not attempted in this pass.
- **Delegated agents.** The owner has asked for none, so the whole pass was worked directly. That is
  a deliberate owner decision, not an oversight.
- **Dim-sum release code name.** The workflow published without one. Worth checking whether the name
  pool is exhausted, since a per-push cadence spends it quickly and exhaustion is designed to be
  non-fatal and therefore silent.

## Session close, 6 September 2026 (later)

Frontend and routing API both at `7297e1b1d883a112e1cc9b0a5adb794b625848aa`, deployed on the
Compose host and serving publicly (`v0.1.0 · 7297e1b`, built 2026-09-06 15:38:34 EDT). 375
tests, 374 passing; the one failure remains the garage-evidence test, which correctly refuses a
TTC allocation source whose `validThrough` is 2026-09-05.

### Delivered

- **A departure is tied to its vehicle block.** The timetable publishes `block_id`, which is the
  operator's own statement that one vehicle runs a named sequence of trips in order. For a leg
  that has not departed, the previous trip on that block is resolved and its vehicle identified
  either by the trip identifier the realtime feed publishes or by position against that trip's own
  stop times. Exactly one candidate or nothing is claimed.
- **A finding worth keeping.** On the live corridor the winning method is
  `block-predecessor-trip-id` — the realtime feed publishes the *previous* trip's identifier while
  the leg carries the next one. That is why the direct trip-identifier join never worked and why
  the block chain does.
- **Race endpoints, real routes and the draw.** A leader picks a start and a finish through the
  published place search, the routing API supplies the journeys, and each team is drawn one.
  Two departures riding the same lines count as one route. A shortfall is counted and shown.
- **GO cancellations are planned.** The alternatives Metrolinx names inside a cancellation alert
  are parsed into an origin, a destination and a departure time, placed on the alert's own Toronto
  service date, and looked up in the real timetable.
- **Metrolinx alerts reach the frontend** through the routing service, which holds the operator
  key so a browser never does.

### Verified on the deployed build

- **Block chain, at the API.** A live plan on the Warden corridor named four real buses that would
  previously have shown only "this departure has not started": route 68 bus 6682 (block 680880),
  route 68 bus 6638 (block 680770), route 17 bus 6018 (block 170552), and route 68 bus 6609
  (block 681442, matched by position).
- **Race, in the built browser.** Driven through the cheap headless route on an off-screen
  desktop with a single proven page target. Union Station to Kipling Station returned 10
  journeys, reported as "2 of them genuinely different". Three teams drew: Red and Blue got
  `KI → 2`, Green got `1 → 2`, and the shortfall disclosure appeared word for word. The board
  showed each team its drawn route. At 360 px there was no horizontal overflow and no clipped
  element.

### Not verified, and why

- **The block-chained vehicle card is not yet captured.** The API proof above is real and the
  render strings are present in the publicly served bundle, but the planner's combobox resisted
  three scripted attempts and no capture of the rendered card exists. Treat it as unproven.
- **GO cancellations cannot be verified against real alerts.** The Metrolinx feed refuses the
  request with the credential currently on the host — GO **vehicles** are refused too, so this is
  not specific to alerts and is not caused by this change. The panel correctly reports the feed as
  unavailable rather than showing calm, and that honest state is what was observed.

## Session close, 6 September 2026

Frontend `140aca9ea5b921958abcd63d9a50ba99fd4c4e61`, built `2026-09-06T17:47:57.044Z`, public provenance checked and healthy. Routing API `gtha-transit-api:8953a5eb`. 339 tests, 338 passing; the one failure is the pre-existing garage-evidence test, which correctly refuses a TTC allocation source that expired on 5 September.

### Delivered and verified on the deployed build

- **Leg alerts narrowed.** A station facility notice reaches a leg only where the leg calls at that station. Service and facility notices are labelled apart and every match renders.
- **Line state follows service, not facilities.** All five rapid-transit lines were reporting a service alert when all 26 alerts were escalator notices. A line now reads as running with its facility count beside it; a published delay still marks it disrupted.
- **Vehicle identification.** Measured cause: the TTC realtime feed shares no identifiers with either timetable - 1 of 406 trip identifiers matched on the same route, and 0 of 192 stop identifiers were within 300 metres of the stop the timetable gives that number. The exact join now requires the route to agree; a position join matches within 150 metres of the stop the trip should be at, using the newly published stop times; a departure that has not started says so and names the closest vehicle on its route with a measured distance.
- **Stops ahead and are we there yet.** The routing API now asks OTP for each intermediate stop's own arrival and departure and passes them through unchanged. Nothing is interpolated.
- **Confirmed closures.** Only a No Service effect counts, reaching a leg through the publisher's own affected-stop list, with official shuttle text verbatim and an explicit statement when none is published.
- **GO super express.** Six declared identities badge on the leg from the published headsign prefix, and route-scope identities badge on the picker and tracker.
- **Fleet coverage.** 85% to 99% across every agency: GO 15 to 95, Hamilton 0 to 99, Burlington 0 to 100.
- **Race rooms.** Bounded rooms with teams, join codes, position sharing that starts off and clears on stop, and check-ins with browser re-encoded photos. Driven end to end on the deployed build.
- **Readiness route.** `/api/dependencies` reports the private routing and map origins. `/health` keeps its own contract.
- **Capture promotion unblocked.** The canonical target verifier the helper spawns had never been committed. It is now, and the first capture passes version-1 validation.

### Outage record

The routing API on the private host exited and stayed down for six hours before this session found it; `docker start` then brought it up with no network, and only `docker compose up -d` restored it. Separately, an attempt to publish OTP on the LAN took the port an unrelated service already held and interrupted routing until the compose file was reverted from its backup. Both are recorded in the deployment article.

### Open

Burlington's 2xxx units are absent from the published roster rather than mismatched. Physical devices, browser zoom and the complete language matrix remain unverified. Co-locating the routing API is documented with its real trade-off: OTP's graph and the map tiles stay on the second host either way.

## Stops ahead, arrival answer and vehicle identification: deployed and verified, 6 September 2026

Frontend `6f5ff7b81d2491f85b454a14d3bdf1f9d159d5f5`, built `2026-09-06T16:58:19.482Z`, public provenance checked and healthy. Routing API `gtha-transit-api:8953a5eb`, running.

**The routing API now returns published stop times.** Its OTP query asks each intermediate stop for `arrival` and `departure`, and passes `scheduledTime`, `estimatedTime` and `delaySeconds` through unchanged. A real Eglinton to Kennedy journey returns a scheduled time for every intermediate stop.

**Deployment lesson, recorded so nobody repeats it.** The API image must be built from the host tree at `~/gtha-transit-backend`, not from a `git archive` of this repository. The repository ships `data/stops.json` as a 240-byte placeholder while the host holds the real 17.5 MB index, so an image built from the repository has a working health check and an entirely empty place search. That mistake was made and caught here: place search returned `{"places":[]}` for every query until the image was rebuilt from the host tree with the changed `backend/*.mjs` copied in.

**Live browser evidence.** Following an Eglinton to Kennedy Line 5 trip, the follower shows `Are we there yet? Not yet.` with `Getting off at Kennedy Station - Subway Platform, 14 stops to go, about 38 min`, and a Stops ahead list of six entries reading 8, 10, 13, 16, 18 and 19 minutes, each labelled `timetable`. No horizontal overflow. The note states the figures are counted from published stop times and are not a live arrival prediction.

**Vehicle identification narrowed to where the trip is.** A route 68 leg with 42 intermediate stops previously reported that several vehicles qualified and named none, because a 14.9 km corridor makes most of the route's fleet a candidate. The position join now uses the stop nearest the current moment, plus one either side. A sweep of ten corridors returned 97 transit legs: 20 exact-trip matches, 5 position matches, 72 departures that have not started, and zero ambiguous or unmatched.

**A departure that has not left is now said so**, rather than reported as a vehicle that could not be verified.

**Not claimed.** The captures remain private pending version-1 promotion validation. Physical devices, browser zoom and the complete language matrix were not exercised.

## Bus vehicle identification: root cause measured, repair deployed, 6 September 2026

Frontend `974a8ed45b913bcf55d750900a174daf1e7833ec` plus the heading correction above it. Public provenance checked and the container is healthy. Frontend only; routing, graph and map services untouched.

**Root cause, measured against the live feeds.** The TTC realtime vehicle feed does not share identifiers with either loaded static timetable.

| Identifier | Measurement |
| --- | --- |
| Trip | 406 live identifiers; 104 also exist in `ttc-next`; only **1** carries the same route |
| Stop | 309 live identifiers; 192 also exist in the timetable; **0** are within 300 m of that timetable's stop, distances up to 23 km |

An exact trip join therefore cannot succeed for the TTC, and any join built on either identifier would name the wrong vehicle rather than none. This is a publisher data property, not a matcher defect.

**Repair.** The exact trip join now also requires the route to agree, so a number collision assigns nothing. When no exact identifier matches, one vehicle is identified when it is on the leg's route, its published position is within 150 metres of a stop the leg calls at, the observation is inside the leg window, and its position is fresh. Exactly one candidate is named as **Vehicle seen on this leg**, with a visible note that it was identified by position; several candidates are reported as several and none is chosen.

**Live sweep on the deployed build.** Ten corridors planned for the current instant returned 56 transit legs: 1 exact-trip match, 6 position matches with real fleet numbers 3330, 7116, 7090 and 8365, 11 honestly ambiguous and 38 with no candidate. Before this change every one of those legs reported no match. The sweep ran at about 02:00 on Sunday with night service only, so it is a floor rather than a typical yield.

**Not claimed.** A position match is not an allocation. On a corridor with departures minutes apart the same observed vehicle can satisfy more than one departure, because the operator publishes nothing tying a vehicle to a departure. Rendered browser verification of the new heading and note is still pending, and the captures remain private.

## GO super express badge: deployed and verified, 6 September 2026

Frontend `bad8a328e88f1e8d50427684ad5bc8f79f1fc418`, built `2026-09-06T05:49:11.011Z`. Public provenance checked and the container is healthy. Frontend only; routing, graph and map services untouched.

GO's published route catalog carries numeric routes and no branch letters. The branch is on the trip, written at the head of the headsign, and the real GO feed confirms every declared identity as a published prefix: `16` on 3083 trips, `47D` 2007, `12B` 1910, `25C` 1534, `56A` 421 and `88C` 228. `lib/go-express.ts` reads that prefix and requires the leg's own route number plus exactly one letter, so `56B`, `561`, `156A` and a bare `56` stay unlabelled.

**Live browser evidence.** Niagara Falls Bus Terminal to Burlington GO at 10:00 Toronto returned a GO leg headed `12 · 12B - Burlington GO` carrying one badge with identity `12B`, the original mark and the declared-provenance text in both the tooltip and screen-reader copy. Hamilton GO Centre to Union Station Bus Terminal returned `16 · 16 - Union Station` with a route-scope badge. A TTC-only Eglinton to Kennedy journey rendered zero badges. At 320 by 844 with device pixel ratio 1.5 the badge measured 157 by 25 with no horizontal overflow, contrast 12.6:1 light and 10.46:1 dark for the pill, and 6.36:1 light and 8.77:1 dark for the identity chip.

**Not claimed.** Super express is a classification declared by this project's owner, not a label published in the GO feed, and every badge says so. The badge is an original mark and is not any operator's trademark. The route picker and live tracker do not yet show it. Captures remain private pending version-1 promotion validation.

## Leg alerts narrowed: deployed and verified, 6 September 2026

Frontend `9b4b8a2e802e934eca74653c5fbe6f37ed4d3225`, built `2026-09-06T05:28:54.820Z`. The public and LAN provenance responses match exactly and the container reports healthy. This slice changes only which alerts appear beside a journey leg; the routing API, routing graph and map service were not touched.

A journey leg now selects its alerts through `lib/leg-alerts.ts` using the publisher's own fields. The route must match or be network-wide, the alert's active window must overlap the leg, and a station facility notice is shown only when the leg calls at the station the TTC names in its own title prefix. An unrecognized `routeType` is treated as a facility notice rather than promoted to a service disruption. Every match renders; service and facility notices are labelled distinctly and keep the original wording.

**Live browser evidence.** On the deployed build, Eglinton Station eastbound to Kennedy Station at 09:00 Toronto returned a Line 5 itinerary. The Line 5 alert list held four entries at the time: one eastbound delay at Mount Dennis, and escalator notices at Kennedy, Keelesdale and Chaplin. The leg rendered exactly two alerts - the Mount Dennis delay labelled Service alert, and the Kennedy escalator labelled Station facility, because the leg alights at Kennedy. The Keelesdale and Chaplin notices did not appear. Before this change the leg would have rendered a single unlabelled entry chosen by list position.

Measured at 1426 by 963 with device pixel ratio 1.5, and again at 320 by 844 with ratio 1.5 in both themes. There was no horizontal body overflow at either width, zero unnamed interactive controls, and dark-theme contrast of 7.84:1 for the service alert and 10.46:1 for the facility notice. The browser ran on an isolated hidden desktop through a task-only loopback debugging port; the target list held exactly one page whose URL matched the site. Its owned processes, profile, port and desktop were removed afterwards and the removal was confirmed.

**Local checks.** Type checking passed. The suite is 235 tests with 234 passing; the single failure is the pre-existing garage-evidence test, which correctly refuses the TTC allocation source that expired on 5 September. Thirteen new focused tests cover the selection rules, and both narrowing rules were deliberately broken and confirmed red before being restored. Focused lint on the new files is clean, `app/page.tsx` holds the same 34 findings it held before this change, and the production build passed.

**Not claimed.** The raw captures remain private: promoting them still requires the version-1 evidence validator, whose recorded blockers are unchanged. Physical touch devices, browser zoom and the complete language matrix were not exercised.

## Resume here: owner-requested handoff, September 6, 2026

Implementation has stopped at the owner's request. No race-planner implementation was started. The primary checkout is on main; latest implementation commit is `9d1ac6ef1c9758cde7c8967f487c2dba1ff24c5d`. Earlier sections below are historical evidence, not alternative current deployment claims.

Current frontend: `9531de6afb1e667c44bb7d9a3010e261571198c5`, built `2026-09-06T04:21:28.081Z`, public version independently checked. Current routing API image: `gtha-transit-api:9d1ac6e`, running. That API image is an incremental layer over `gtha-transit-api:6d51bd3`, replacing only `otp-client.mjs` and `required-line.mjs`; it is not a full rebuild of every source file. Routing graph and map service were not replaced.

### Next work, in priority order

1. Implement the requested transit race planner: teams, common A-to-B locations, optional multiple meetups, route assignment wheel, leader joining and explicit per-race GPS sharing with stop-sharing controls. Use real routing results and separate planned arrivals from actual check-ins. The optional question whether teams must receive different routes has no recorded answer; prefer distinct routes when available and disclose insufficient alternatives. No race UI, sessions, persistence, GPS sharing or tests exist yet.
2. Implement confirmed subway/light-rail closure handling in routing and officially announced shuttle guidance. Never invent shuttle stops, times or exact vehicles. The unrelated line-level facility alert defect is repaired and verified on the deployed build; closure and shuttle handling remain open.
3. Repair bus schedule/live trip-ID matching. Reproduction: route 68 planned trip `50723818`, live fleet 3201 on route 68 with trip `77311070`. The new explanation/tracker link is not the mapping fix; do not assign a bus by route equality alone.
4. Verify the next-stop name repair in the built follower. Agency-qualified IDs and exact stop-index name lookup are implemented, with cancellation/deadline and nine focused tests. Vehicle-only and journey simulation require actual rendered checks.
5. Verify contextual place suggestions. Warden map station now receives explicitly nearby route data without moving the destination; the distant same-name location remains separate. Three focused tests pass. Address/landmark context remains limited to published source fields.
6. Continue all-agency fleet details/photo/capacity research. 72 Barp.ca series plus 11 directly reviewed Milton records are implemented. Browser-extracted CPTDB tables for nine agencies are retained privately and mostly unreviewed. Punctuated Burlington fleet numbers require exact parsing; build year must not be inferred from fleet number. Standing capacity and photo reuse rights remain incomplete.
7. Refresh expired TTC garage evidence from a new official source. The current document ended September 5. The HTTP test expecting MtD now fails correctly against expired evidence; never extend the source validity without publication proof.
8. Verify the deployed vehicle chooser, staged cancellation/apply, nested search stars and narrow footer/recovery focus. Complete the wider language/theme/scale and physical-device evidence separately.

### Latest decisive evidence

- Required-line generated anchors now use OTP passThrough; user destinations retain visit semantics. Four focused OTP tests pass, including staying aboard and rejecting reversed anchor order.
- Live Golden Mile to Eglinton at September 6 09:00 Toronto with required route TTC 5 returned seven options. The first has WALK, one continuous TRAM route 5 trip `ttc-next:134935404`, WALK. No Sunnybrook Park reboarding step occurred. This is a bounded API check, not complete UI or all-route evidence.
- Regional fleet full suite passed 217 tests before the later small repairs; it is not a current full-suite verdict. Milton followup passed 24 focused fleet tests. Follower repair passed type checking plus nine focused tests.
- Place-context plus HTTP run passed eight tests and failed one garage-evidence test. Whole-page lint previously retained 33 findings. Neither result is green.
- Capture helper has 29 tests and honestly validates record consistency only. Older untimed captures and retained browser profiles must not be promoted with fabricated timing or cleanup proof.

### Continuation constraints

The owner explicitly requested no more delegated agents; continue directly unless they change that request. Use the isolated cheap Lowlevel browser route. For CPTDB research only, the owner explicitly allowed page-created iframe targets alongside one exact top-level page; unrelated pages, workers and extensions remain disallowed. Do not copy this research exception into production UI audit claims. Private retained browser profiles and raw research belong outside this public repository. Do not delete existing worktrees merely because they look old or merged; ownership and preservation must be checked. No task-owned cleanup was performed during this preservation handoff.

Open task issues: #1 for planner/UI and #3 for source/live fleet gaps. No whole-goal completion is claimed. Public wiki endpoint and authenticated Status Hub limitations remain as recorded below.

## Required-line unnecessary transfer repair

Internal required-line anchors were encoded as OTP visit points, which explicitly require boarding/alighting. They now use passThrough stop identities; completion verifies the ordered stop occurrences including intermediate stops. User-created destinations retain physical visit semantics. The Sunnybrook Park Line 5 report motivated this repair. Real backend verification is still required. Closure-aware planning and official shuttle notices are newly recorded requirements; current whole-line alert attachment can show unrelated facility notices and must be narrowed before claiming accurate leg alerts.

## Follower stop-name repair

The follower now compares publisher stop IDs using agency-qualified identities and the known TTC timetable alias. Vehicle-only following resolves a missing name through the exact stop-routes endpoint, with an eight-second deadline, cancellation and keyed response handling. Failed lookup retains the publisher identifier; it never guesses a nearby stop. Type checking and nine focused identity/progress tests pass. Real rendered verification remains pending. The garage HTTP regression is separately explained by the allocation source expiring on September 5; production correctly withholds expired evidence, so the source must be refreshed rather than extending its date without evidence.

## Bus assignment reproduction

A current Warden/Steeles to Victoria Park/Eglinton probe returned TTC route 68 with planned trip `50723818`; the fresh TTC vehicle snapshot included fleet 3201 on route 68 with trip `77311070`. This confirms a timetable/live identifier mismatch for the reported bus journey, not a dropped display value. Route equality alone does not establish the assigned departure. The UI now explains exact-ID no-match and offers the live tracker, but the identifier mapping itself remains unresolved. The preceding place-context run passed its three focused tests and five HTTP checks; the separate division endpoint check failed its expected MtD garage evidence and must not be reported green.

## Contextual place suggestions

The Warden report exposed map results without route data ahead of route-rich TTC platforms. The frontend service now adds explicitly nearby transit context only from stops within 250 metres in the same search response, retaining exact destination identity. Suggestion rendering distinguishes timetable service from nearby routes, shows straight-line distance/stop name, localizes place-specific types and uses published address/district/city when supplied. No location-name-only route inference or invented opening hours is used. Built interaction verification remains pending.

## Direct browser fleet research

The approved isolated browser route now permits CPTDB-created iframe targets alongside one exact top-level page. Nine agency pages yielded structured tables with revision links; Durham remained unavailable in this attempt. Added 11 Milton conventional-fleet records from revision 857419 and verified the separate propulsion history of 1701/1702 against revision 804140. All 24 focused regional/vehicle tests pass. Other extracted tables remain unreviewed research, not claimed shipped coverage. No image rights or standing capacity were invented.

## Regional fleet expansion

Added 72 published manufacturer/model/year series: MiWay 16, Brampton 19, Durham 20 and YRT 17. The matcher preserves YRT electric prefixes and keeps external roster provenance separate from CPTDB search links. The source is the first-hand Barp.ca photo roster, which explicitly is not a complete active fleet. No image reuse licence or standing capacity was invented. The 23 focused regional/vehicle tests pass. All-agency research remains incomplete, with explicit gaps and source leads in docs/vehicles/regional-research.md. This change affects the frontend's vehicle service and preference catalogs; no routing graph rebuild is required.

## Vehicle chooser implementation awaiting runtime verification

The vehicle chooser now opens a dedicated wide dialog instead of a nested narrow panel. It stages edits until Apply, normalizes Off/Prefer/Avoid to exclusive modes, exposes unconfirmed-journey consequences immediately, and gives manufacturer and model searches isolated star workbenches. Narrow layouts show Company, Model and Years sections with focus/scroll navigation; invalid years block Apply and provide an exact-field recovery action. The existing parent preference writer remains authoritative. TTC garage preferences have a separate visible disclosure.

The prior live inspection at `e3e70ab` measured the old panel at 300px wide on desktop and 1412px tall when expanded at 320px, with 204px useful inner width. Changing company cleared the old model and year validation worked. New chooser runtime verification remains pending. Local integration before the capture-helper merge passed 185 behavioral tests, type checking and focused component/helper lint. The capture helper separately passed 29 tests, including unsafe URL rejection before persistence, actual capture-call timestamps and rejection of retained resources. It proves record consistency only, never visual correctness. Open-ended year repair `a48f1be` passed 13 evaluator tests; invalid ranges do not boost or hide journeys.

## Journey time deployment and verification

Latest frontend: `e3e70abfbbf6aceb6f52b232dcaa89085ad4038d`, built `2026-09-05T20:24:41.837Z`. Public and LAN provenance match and the container is healthy. Workflow `33990014656` succeeded and published `v0.1.0-65.1` for that exact commit; its web archive and line-count asset returned HTTP 200. This followup changes only the stable hydration effect dependency and handoff records, with type checking, focused lint and the production build passing. The remaining whole-page lint count is 33, including zero `setWhen` findings. Browser interaction evidence below belongs to `9391cba`, not a new run against the followup.

Frontend `9391cbad8a25e8ad3ee8c6ecc08dea9f4f553330`, built `2026-09-05T20:13:48.966Z`, was independently verified on public HTTPS and the LAN fallback with a healthy container. Workflow `33989468767` succeeded; release `v0.1.0-64.1` points to the exact commit and both published assets returned HTTP 200. The recovered served bundle has SHA-256 `429846b9f7fc424c69b7c69b56b640468ca4fe0d601d595d930f81208659d65a`.

The frontend separates Date and Time, adds explicit departure/arrival radios and a selected Toronto offset, preserves incomplete edits, and puts Reverse trip into its own labelled row. Helpers in `8b7bb4b` calculate tomorrow by Toronto calendar date and preserve exact shared/stepped instants across the repeated hour. Leave now selects departure mode. Invalid fields cannot silently plan now, produce an agency-coverage verdict or be shared with a false time-included claim. Twelve helper tests and the full 178-test local suite passed, along with type checking, focused lint for the new component/helper and the production build. All 12 helper tests also passed with the device timezone set to Pacific/Auckland. Whole-page lint is not green; its new stable-callback dependency finding is corrected by listing `setWhen` on the hydration effect. Two independent source reviews found and then confirmed repairs for incomplete-date coverage and reverse-control accessible naming.

The real `9391cba` browser run verified native Date and Time clearing separately, zero planning requests from either invalid submission and no false agency-coverage warning. Arrive by followed by Leave now selected departure mode; Tomorrow set 09:00; a real plan followed by 30 min later changed the submitted instant from 13:00Z to 13:30Z, exactly 1,800,000 milliseconds. Union's full selected name no longer overlapped Reverse trip at 390/320px light/dark or 320px bilingual states. Diagnostics reported zero application exceptions, console errors, bad responses, failed resources and unnamed interactive controls. Public capture promotion was refused: the helper did not record the actual PNG timestamp, and owned teardown remains incomplete. A later focus-probe timestamp must not substitute for capture time. The profile-removal action was rejected by automatic approval review with only `blocked by policy`; the final process probe also still found the owned process despite the cheap helper reporting it killed. The endpoint and hidden desktop were closed. Retain private raw evidence and repair the timestamped capture/teardown path before public promotion. No image or inventory entry was added. Physical touch, 360px, audible narration and the complete language/scale matrix remain unverified.

The prior live `1e428b1` destination run verified real Union, Bloor-Yonge, St George and Eglinton selection; arrow and actual pointer-drag ordering; map labels A/1/2/3; and a September 6, 09:02-09:56 four-stop journey whose request preserved both intermediate stops. Eglinton's route-1 colors and washroom identity matched an independent response, with opening hours correctly unconfirmed. That run measured the old reverse icon overlapping Union's selected-name text at 390px. Save/share, physical touch and the broader matrix were not exercised. Its owned browser resources were removed.

## Earlier settings deployment and verification

Current frontend: `1e428b1e320f2046e9abc9b49f2d508e68aef274`, built `2026-09-05T19:53:14.945Z`. Public provenance and healthy container identity were checked independently; workflow `33988440515` succeeded. Settings now has Appearance, Language, Narrator and Privacy tabs, guided theme/language choices, independent tone sliders, and collapsed global/section searches with direct control focus. The original preference writer still retains vehicle criteria and division options, and one parent-owned narrator controller remains alive across panel changes.

The `e0ea605` browser run verified all four sections by pointer and keyboard, both themes, independent English level 2 and Cantonese level 3, bilingual mode, reload persistence, exact Rate search focus, quiet-mode restoration and a single narrator instance. It exposed a stale enablement notice and two unnamed tuning sliders. Commits `c39ffad` and `1e428b1` repair those findings and remove duplicate visible headings through a real screen-reader-only utility. The `1e428b1` correction run verified immediate notice removal after enabling, exact Rate focus, and accessible names Rate and Pitch. Five desktop/320px light/dark and narrator captures passed the official version-1 audit validator. Each checked accessibility tree had zero unnamed interactive controls; diagnostics had zero application exceptions, console/log errors, bad HTTP statuses and resource failures, with only the site's own network hostname observed. A keyboard path had a visible 3px outline. Local validation at the settings integration passed 169 existing behavioral tests, type checking, focused lint and the production build; these checks are distinct from runtime evidence.

The exact recovered served-static bundle for `1e428b1` has SHA-256 `25e023b41a8997eaffe2c66deaf60ebc2e5cb880351175917c38d3ce54f987ec`. Both settings browser runs removed their exact owned processes, ports, profiles and desktops. The earlier run's raw captures remain private. The final Appearance capture passed version-1 promotion validation, was staged byte-for-byte and independently reopened from `docs/captures/settings-appearance-1e428b1.png`. Its SHA-256 is `ca4dbe60bc9363cf4066a6cb07d27f2f1a39553c6b9f6c8a5ab445f4d7d9a3b2`; README, the settings article and the capture inventory carry its exact source and scope. Physical touch, audible narration and the complete language/zoom matrix remain unverified.

## Guided picker baseline

Earlier picker frontend: `b7e0ae4215433ffee376891cbcad25404cbb64ac`, built `2026-09-05T16:48:05.483Z`. Public provenance and healthy container identity were independently checked. Release `v0.1.0-58.1` targets this commit, and workflow `33978959088` completed successfully. The exact recovered served-static bundle has SHA-256 `5f0814075f36a960389546d63ef8f04e4b955d3104bfdce94a277b4667bb325c`.

The guided route picker adds agency-first and route-second phone steps, a two-column desktop view, agency route counts, official route badges, Back and Cancel, and independent search stars. Its production loader validates complete catalog pagination, identities, totals, cursors and timetable periods, commits records with their date, and refuses outdated or disallowed selections. The live loader read 783 routes from 11 agencies with 70 missing colors kept unknown. The full local suite passed 168 tests at `145398a`; the followup's nine focused loader/selection/alias tests, type checking, focused lint and production build passed at `b7e0ae4`.

At `145398a`, real browser checks verified agency filtering, TTC selection, Back, Cancel, actual TTC route 1 selection, all-routes selection, separate stars and nested-workbench Escape. They also exposed one unintended planning request from Enter on a radio inside the required-route picker. The completed `b7e0ae4` browser run verified zero planning requests at every measured stage: valid Union/Eglinton endpoints, agency-search Enter, route-search Enter, radio Enter and actual route-button Enter. `Toron` found TTC; Space selected the regex mode; Enter activated Add test case and closed only the inner workbench. The selected route became TTC route 1. No checkbox exists in the exercised nested surface, so checkbox-specific runtime evidence is not claimed. The fresh run retained two timestamped captures and exact target receipts, reported zero application exceptions and console errors, and removed its own processes, port, profile and hidden desktop. Two inspection probes targeted a nonexistent checkbox and are recorded separately as verifier errors.

The earlier interrupted `b7e0ae4` attempt recorded only initial state and teardown; it is not reused as interaction proof. The completed browser run supplies the correction evidence. The reusable Chromium Enter character-event method is recorded in the canonical private workflow memory; no private paths or vocabulary are published here.

The `route-picker-keyboard-b7e0ae4` capture passed version-1 promotion validation against the exact served bundle, source commit, recorded times and interactions, target-isolation receipts and privacy review. Its raw/promoted PNG SHA-256 is `47699c581d35a5f7ca9c62e30ed89d2f16edecc87a35198cf0beb6903f149479`, at 1440 by 1000 pixels. README and the picker article display the exact inspected bytes. The evidence inventory retains the bounded scope and separate helper-probe errors. Broader surface and language/zoom verification remains open.

## Earlier deployment and verification evidence

Evidence promotion completed for `tracker-bilingual-b1829a9`: version-1 validation passed with source `b1829a9`, served-bundle SHA-256 `90e0d34db96d7168dff4ea59aba73341ee6dfd0cd2ecee566698cc200d29dbcd`, and raw/promoted PNG SHA-256 `ee397ca95b83395d9898e83969d96195116053283b3875fc7197a60a22f2ce3d`. The PNG was independently reopened after byte-for-byte staging. README and the workspace article display it; the inventory records its actual tuple and limits. Other capture promotion and the complete matrix remain open.

Earlier tracker deployment: `b1829a948358c9b9b532d033f174f0b8214563c7`, built `2026-09-05T16:20:06.947Z`, was healthy on public HTTPS and the LAN fallback. Workflow `33977517160` succeeded and release `v0.1.0-55.1` is published. The followup tracker capture measured the map at document Y 482.5 at 320px, ahead of fleet filters at Y 902.5 and source explanations at Y 994. Pointer refresh made exactly one additional vehicle request and re-enabled; the 44px star and fleet disclosure worked. Six new captures had no body overflow; the recorded event stream had zero runtime/console errors or HTTP responses >=400. The bilingual 320x844, DPR 1.5 capture passed promotion validation; other snapshots retain their honest receipt limits. Both redesign browser runs removed their exact owned processes, ports, profiles and desktops. An older star-only task profile remains because its deletion was rejected by automatic approval review.

Redesign verification baseline: `34f6ffff4c54a50cc5501b7c7d7cd70bae74cafe`, built `2026-09-05T16:14:48.673Z`. Public provenance was independently checked. The new desktop rail, phone Plan/Vehicles/Live TTC/More navigation, full-width tracker and dedicated planning composition are deployed. The following star-only baseline remains historical context. A further tracker composition adjustment moves repeated introduction/feed/filter content below the map so the map appears sooner.

At the redesign baseline, real pointer and corrected keyboard Enter activation each saved a regex snippet, and both survived reload. The earlier Enter-only result is refuted: the verification helper omitted the character-bearing event required for native button activation. More close returned focus, and a selected Union origin survived Vehicles navigation and return to Plan. The desktop tracker measured 1137px wide with a 1137x530 map. Raw desktop and 320px light/dark captures cover planning, tracking, settings and More; public evidence promotion and the full language/scale matrix remain pending.

Four public routing smoke requests at September 5, 13:00 Toronto time returned 33 complete itineraries with 42 transit legs and no structural or chronological inconsistencies: Union-Finch 10, St George-Kennedy 10, Union-Richmond Hill Centre 9 and Union-Pearson Terminal 1 4. The York-region connections used TTC plus York Region Transit with transfer waits of 160-270 seconds. This evidence does not establish physical travel or exact current vehicle assignments.

Frontend: `5482814a170fbeb614faa09e9442c29d4d03c20f`, built `2026-09-05T15:40:39.307Z`, live at https://toronto-transit.org. Public and LAN version responses independently match, and the container reports healthy. Backend image: `gtha-transit-api:6d51bd3`, independently inspected. The frontend-only deployment preserved the routing and map services. Their previously verified graph is `f4763bf444d82e922b892ff2a4dd3368176df4f308d63b7743617e7cc9c9e2b4`; map revision is `199cc9933f670a7fc1c33099a18891a53f5d187212c0041ce2b95ac6bafd381c`.

The compact regex star is deployed across the shared search fields. It retains localized accessible names, tooltips and a 44px target. The workbench now uses a native nonmodal dialog, and snippet save/import/delete persist directly from their user actions with per-field storage isolation. Local production build, type checking, component lint and all 160 existing behavioral tests passed. Native browser interaction, actual computed geometry and snippet persistence are being checked separately; source review alone does not establish them. Release `v0.1.0-53.1` targets this exact commit and includes the web bundle and line-count report. Workflow run `33975502449` completed successfully without running tests.

Earlier tracker evidence at `6d51bd3` exercised manufacturer/model/year filtering, inline invalid-year recovery and the exact-assignment division preference, with four 1440/320 light/dark captures and no body overflow. Its overall run remained red because the regex verifier expression was malformed. The later `3ef84dc` run separately verified plain and regex matches, clearing both modes, restoring 100 list rows and returning focus to the input, with desktop and 320px captures. These are separate evidence scopes, not one retrospectively green run.

Route-level out-of-division opportunities were deployed at `fecb61e` independently of exact-trip assignments. A public route-929 request returned six itineraries with current route evidence from unit 8189 while exact vehicle assignment remained `no-match`. The route preference never labels that observed unit as the passenger's assigned bus.

Expanded indexes contain 38526 stops, 1015 source routes and 4070 representative patterns from 16218863 stop-time rows. Of 575587 declared trips, 575517 have stop times. The 70 empty HSR trips are explicitly excluded from patterns. Source archive checksums and exact exclusion arithmetic accompany the generated indexes. Compact query normalization is deployed to the map service; the public query `high7 ward` returns Highway 7 & Warden Avenue first.

Public required-Line-5 planning returns two complete Eglinton-to-Union itineraries with exact `ttc:5` transit legs. The shorter adds 860 seconds compared with ordinary routing. The stop-identity fix uses OTP `visit.stopLocationIds` for official platform anchors; coordinate visits had failed at platform edges. Ordinary user places remain coordinate visits. Additional Sep5 noon waiting-preference probes returned Kipling-Finch 10, Don Mills-Yorkdale 8, Scarborough Centre-Union 10 and Brampton Gateway-Pearson 9 itineraries.

The public washroom flow is verified after the direct-walking correction. A fixed public-coordinate example near Yonge/Bloor to Union at Sep5 noon now selects Toronto Reference Library with a 287-second direct WALK, arrival `2026-09-05T12:04:47-04:00`, and onward departure after a planned ten-minute visit at `2026-09-05T16:14:47Z`. The earlier 2455-second High Park result was superseded: it inherited transit-only routing and omitted nearby direct walking. Ordinary journey requests retain transit-only behavior; the washroom helper explicitly allows direct WALK plus transit. The focused mode/detour suite passes 18 tests. Published hours are not live door or queue status. Selected Eglinton platform `ttc:13795` independently exposes its official route and agency-qualified washroom with unknown hours.

Built-browser evidence binds to `b92de7c`: shared noon Eglinton-Bloor-Yonge-Union planning, follower simulation Next, washroom review mark/restore without GPS, and both close-focus returns passed. Six 1440/390/320 light/dark captures show zero body overflow, loaded Manrope weights 400-800, zero console/runtime/resource failures and no analytics injection. The required-Line-5 request with the extra via returned one complete route chain 5,5,1,1. The verifier incorrectly expected two, so its count-only finding was refuted. The later frontend delta contains the POST repair, bounded washroom payload, opening-hours wording and empty-card suppression; those changes are not retroactively part of the b92 captures.

Browser stop-badge selection remains unverified because no post-selection identity or response was retained. API enrichment is verified separately. Physical touch, spoken audio, live GPS progress, all vehicle-switching paths, drag reordering and public evidence promotion remain outstanding. Final combined local checks: 139 root tests and 58 backend tests passed, along with 6 generator tests and type checking. The expanded registry exposed a stale 25-record fixture; it now checks 32 records and proves all 9 municipal entries remain separate from transit station identities. Workflow builds publish without running tests; a successful workflow is not runtime proof.

## Earlier verification records

At frontend commit `df1c471`, the exact archived source passed type checking, production build and 63 Node tests in an isolated check container. The later combined route-workbench candidate passed 72 local tests. The route catalog and its generated indexes are deployed; pagination independently returned 783 canonical routes over four pages, preserving 70 missing colors as null. The map-service suite separately passes four tests, renderer two tests, and candidate verifier three tests. Those Python results bind to their respective implementation commits; do not describe them as workflow tests.

Real isolated browser interactions have exercised planning, saving, history, vehicle details, exact current UP assignments, both map surfaces, and bilingual dark settings. Home was checked at 320px and 100/125/150/200 percent scales in earlier candidate-specific runs. Current map zoom-13 checks at desktop and 320px show decoded 256x256 tiles, HTTP200 responses, and no stale warning. A controlled offline/online browser check showed the warning during the deliberate outage and complete tiles without the warning after reconnecting and zooming. The automatic one-minute retry is covered by the lifecycle test, not that browser sequence. Physical touch-device verification remains unrun. Public capture promotion still requires validated receipts; local captures must not be relabelled as published evidence.

Pearson search now includes UP Express Pearson Airport as suggestion 7. Keyboard selection and real pointer selection both passed at 320px. The earlier pointer discrepancy came from a target outside the suggestion scroll container's visible rectangle. Clip-aware scrolling and an exact pre-click hit test resolved it. Earlier claims of a Save defect were also refuted because the verifier selected navigation rather than the toolbar action.

## Routing and official coverage

All eleven official GTFS feeds are loaded in OTP 2.9.0. The promoted graph contains 2616564 vertices, 7026484 edges and 37234 transit stops. Its SHA-256 is `f4763bf444d82e922b892ff2a4dd3368176df4f308d63b7743617e7cc9c9e2b4`. Real journeys were verified for Union-Brampton, Hamilton-Toronto, Brampton-Pearson, Durham-Toronto and UP Pearson-Union. The daily refresh uses validated staging and candidate routing checks and preserves the prior graph on failure.

TTC current-date coverage is restored through the independently checksum-verified July26-Sep5 archived publisher feed alongside the Sep6-Oct31 feed. Public coverage reports 32874 TTC trips for Sep5. Public Sep5 noon probes returned 10 Eglinton-to-Union options and 9 Brampton Gateway-to-Pearson options. Burlington still has a current-date calendar gap. Coverage warns for remaining gaps and offers the next covered date. Empty coordinate-based requests now return HTTP200 with no itineraries and neutral graph coverage context; they never infer a required agency from a Toronto rectangle. Search preserves distinct same-name stops at different coordinates, prioritizes actual transit hubs, and retains agency identity metadata.

MiWay, HSR, GO and UP TripUpdates are applied where identifiers match the graph. TTC/Burlington live positions and status remain available, but their current trip updates do not match the active static schedules sufficiently for routing. GO/UP alert feeds have blank entity IDs and are not applied to OTP. YRT requires publisher registration; other unavailable live feeds remain documented rather than guessed. Complete all-agency coverage is not claimed.

## Status, history and washrooms

TTC status uses the official website endpoint with the official GTFS-Realtime feed as fallback. Receipt time measures fetch freshness; publisher update timestamps remain separate metadata. Failed refreshes make line states unknown rather than claiming all-clear.

Disruption collection began at `2026-09-04T23:50:13.603Z`. SQLite retains occurrences and changed versions indefinitely in a persistent volume. Calendar filtering, NDJSON export, and survival across container replacement were verified. No earlier historical backfill is claimed.

Washroom preference uses confirmed facilities at actual boarding and alighting points. Transit facilities may be preferred by presence when hours are unknown; municipal facilities require published open-at-arrival hours. Intermediate pass-through stops display presence without boosting ranking. Urgent diversion permits direct walking and transit to verified-open municipal facilities. The registry now has 32 facilities, 18 source receipts and 12 coordinate-backed records. Seven additional City/TPL branches were deployed in backend image `9e7a39b`; public near-branch probes selected North York Central in 82 seconds and Scarborough Civic Centre in 45 seconds, both WALK. Every new City record was independently checked for one branch, washroom flag and exact coordinates.

## Vehicles and photos

Live positions are decoded for TTC, GO, UP, MiWay, Burlington and HSR. Fleet numbers remain distinct from destination labels. Manufacturer/model/build ranges are populated only where verified sources establish them; other facts remain unknown. CPTDB links distinguish searches from verified series pages. Current directions attach vehicles only through a fresh exact agency/trip match within the journey's current time window. A real UP journey displayed vehicle 3004, Nippon Sharyo DMU C-car, 2014-2015, with an explicitly representative photo.

The TTC LFS Hybrid photo is the verified 960px TTC 3539 image by Dillan Payne, CC BY-SA 4.0, exact only for 3539. Its 173716-byte response matches SHA-256 `618326d57bacbc2fea0b23c094c0ea0f81a5e112e56f8410a1741e0a026ea93a`. A prior contradictory source was removed. TTC XDE60 and HSR photos were also omitted after attribution conflicts; replacements remain open. Other incomplete per-vehicle photo/build-day coverage is explicit. Creator and licence links are separate, and both directions and tracking visibly distinguish representative images.

## Maps and recovery

The local index contains 140315 shared-node road intersections, including the verified Warden/Highway 7 junction. Actual address locality distinguishes Toronto and Brampton. Zooms 8-10 show regional roads, 11 adds collectors, 12 adds local streets, and 13 adds paths/service detail. Major roads paint after minor geometry.

The published map database is 27602944 bytes and preserves all 3646 XYZ keys across zooms 8-13. Every tile fully decompressed and both databases passed SQLite integrity checks. The prior 32866304-byte database, revision `743de19b11113a7fd70d526d535f8a1eb7f605908db65883880d7478f8188fb8`, remains a hash-verified rollback copy. No routing graph rebuild was required.

Both map surfaces request uncached revision metadata every minute and use revision-bound tile URLs. The server rejects obsolete revisions and revalidates unversioned URLs. Active failed tiles and metadata failures are tracked independently; loaded, unloaded and aborted tiles clear only their own failure state. Late errors from removed tiles are ignored. Normal settled loading and controlled offline/online recovery through real zoom controls passed. An earlier warning probe inspected the wrong DOM boundary; the inspected offline/recovery capture pair provides the warning-state evidence.

For a fresh render, use SQLite's backup API to create a consistent source snapshot, switch only that snapshot to DELETE journal mode, and verify integrity before a single-file read-only mount. A live WAL database may need sidecars and cannot safely be copied as only its main file. Match the restricted renderer's numeric user/group to its output-directory owner. Render separately, run `maps/verify_mbtiles.py`, preserve the baseline, and atomically replace only the validated database.

## Remaining work and operational boundaries

Issue #3 tracks remaining official live-feed, fleet-detail and photo coverage. Public UI evidence receipts/gallery, physical touch testing and broader frontend refinement remain incomplete. Keep roadmap entries factual and do not equate a released bundle with complete source coverage.

The Metrolinx credential is installed in a protected host-only store. The temporary HTTPS intake was removed. Do not print or export credentials. The frontend host does not enforce its requested memory cgroup limit; Node heap and request bounds are not equivalent to a kernel memory cap. Preserve unrelated workloads and the existing routing graph.

The owner approved web-only, transit-focused delivery. Unrelated universal utilities, desktop installers, payment and sign-in features remain outside this release scope.

Vehicle-list pagination, the all-agency default, color-coded rows, embedded map summaries and explicit details navigation are deployed at `6019494`. Earlier real 320px Page2 selection at `310a7dc` automatically focused vehicle3566 details. The new aggregate/popup behavior is undergoing fresh browser verification. First-service and transfer waiting times are deployed; live interaction evidence is pending. Partial-query matching, route selection, manufacturer/model/year preferences and avoidance, out-of-division observations and the opt-in narrator remain active implementation work. Planner-relevant shared UX features are authorized; Ollama and file conversion are explicitly excluded.

## Latest requested work and evidence

The complete cumulative request list is in PLAN.md. The company-first model cascade, guided route picker, independent snippet storage, clear-location control, vehicle divisions, multiple destinations, waiting preference, required-line detours, followers, stop-route data and urgent washroom rerouting are deployed. Verification is scoped as recorded above; do not equate deployed controls with completion of every interaction, source-coverage and physical-device requirement.

Narrator browser verification at df1c471 exercised exact labeled controls, English voice choice, Both, rate, quiet, reload persistence and disable. The host exposed three local English voices and no Cantonese voice option. Four 1440/320 light/dark captures had no body overflow. Physical audio was not tested. That earlier delivered-page audit observed two analytics scripts. The later b92de7c no-transform/CSP correction and browser audit supersede that finding, as recorded above; this does not retroactively change the earlier audit.

The reported route324 journey used static trip ttc:50677154, while fresh live units reported different trip identifiers. Prepared assignment normalization fixes address valid numeric times and TTC version aliases, but the reported mismatch remains unverified. Never label a route-only vehicle as the assigned bus.

The source-feed folder now holds all 12 checksum-verified graph input archives, including both TTC versions. Its prior snapshot is retained outside source control. API and map-service deployment preserved the active OTP process, graph and MBTiles hashes.

The repository's wiki setting is enabled, but the wiki Git endpoint returned repository-not-found during this pass. No wiki publication is claimed. The public documentation remains in this repository. Broader source coverage and physical-device requirements remain open on issues #1 and #3.


## Latest narrow layout evidence

At frontend f45bf93, two 320x844 light/dark captures verify the empty selected-stop cards are absent for shared Eglinton/Union coordinate places, with no body overflow. Both raw images were independently inspected. A literal ISO timestamp-format assertion stopped the later console/network audit; the timestamps represent the same instant, so this was a verifier issue. The exact task browser process, port and hidden desktop were closed. One task-owned temporary browser profile remains because automatic approval review rejected its removal with only `rejected: blocked by policy`; no alternate deletion was attempted. Private machine paths are retained only in the session record.
