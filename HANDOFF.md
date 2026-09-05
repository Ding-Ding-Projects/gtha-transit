# Implementation handoff

## Current verified deployment

Frontend: `f45bf93c55d1f57448de2f3e362613121c35c65f`, built `2026-09-05T11:05:15.77Z`, live at https://toronto-transit.org. Backend source/data: `9e7a39b`, including direct-walk implementation `3b66327`. Public version and endpoint responses were independently checked. The graph remains `f4763bf444d82e922b892ff2a4dd3368176df4f308d63b7743617e7cc9c9e2b4`. Map revision remains `199cc9933f670a7fc1c33099a18891a53f5d187212c0041ce2b95ac6bafd381c`.

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

Narrator browser verification at df1c471 exercised exact labeled controls, English voice choice, Both, rate, quiet, reload persistence and disable. The host exposed three local English voices and no Cantonese voice option. Four 1440/320 light/dark captures had no body overflow. Physical audio was not tested. The strict delivered-page audit is not green: two scripts from static.cloudflareinsights.com were fetched. Investigation and prevention remain required before claiming no analytics.

The reported route324 journey used static trip ttc:50677154, while fresh live units reported different trip identifiers. Prepared assignment normalization fixes address valid numeric times and TTC version aliases, but the reported mismatch remains unverified. Never label a route-only vehicle as the assigned bus.

The source-feed folder now holds all 12 checksum-verified graph input archives, including both TTC versions. Its prior snapshot is retained outside source control. API and map-service deployment preserved the active OTP process, graph and MBTiles hashes.


## Latest narrow layout evidence

At frontend f45bf93, two 320x844 light/dark captures verify the empty selected-stop cards are absent for shared Eglinton/Union coordinate places, with no body overflow. Both raw images were independently inspected. A literal ISO timestamp-format assertion stopped the later console/network audit; the timestamps represent the same instant, so this was a verifier issue. The exact task browser process, port and hidden desktop were closed. One task-owned temporary browser profile remains because automatic approval review rejected its removal with only `rejected: blocked by policy`; no alternate deletion was attempted. Private machine paths are retained only in the session record.
