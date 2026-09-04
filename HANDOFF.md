# Implementation handoff

The initial version is live at https://toronto-transit.org through the owner's tunnel route. A private LAN origin is also configured. Public health, coverage, journey planning, live TTC status and disruption-history endpoints have been verified.

The frontend and static Node service build successfully locally and in the ARM64 container. A committed wrapper lets successful native bundler shutdown complete, correcting the Windows libuv assertion without changing nonzero exits. TypeScript passes. The frontend/status/history suite has 18 passing tests; backend and realtime modules have 8 passing tests separately.

All eleven official GTFS feeds are loaded in OTP 2.9.0. The graph has 2,602,526 vertices, 6,979,806 edges and 27,763 transit stops; the separate search index contains 28,691 stop records. Public journeys were verified for Union to Brampton, Hamilton to Toronto, Brampton to Pearson and Durham to Toronto. A daily refresh uses validated staging and candidate routing checks. Intersection-name lookup and complete map rendering remain under repair.

The TTC parser uses the official TTC website route-alert endpoint with the official GTFS-Realtime source as fallback. Content-update timestamps are metadata; receipt time controls website response freshness. Failed refreshes mark line states unknown. A live probe identified a real Line 1 service disruption. A later source snapshot may differ.

Real browser verification has exercised planning, saving a trip, history navigation and bilingual dark settings. The 320px home surface passed body-overflow checks at 100/125/150/200 percent scales. Bilingual dark settings also passed at 320px. The earlier claimed Save defect was refuted because the test selected the navigation button instead of the toolbar action. Evidence is tied to each deployed candidate; do not overwrite earlier candidate evidence or claim physical-device testing.

Disruption collection started at 2026-09-04T23:50:13.603Z. SQLite retains occurrences and changed versions indefinitely in a persistent volume. Same-day calendar filtering and an NDJSON export containing 32 records were verified. Initial records survived a container replacement. No historical backfill before collection is claimed.

Live feed monitoring covers all eleven agencies with explicit gaps. TTC, MiWay, Burlington and HSR publish verified live endpoints. OTP applies matching MiWay and HSR updates. Burlington currently has incompatible trip identifiers and remains status-only. GO and UP require the owner's registered Metrolinx key; a temporary secure intake and protected internal proxy are prepared. Other agencies' unverified endpoints remain unavailable, never guessed.

The web host does not enforce the requested memory cgroup limit. Node heap and concurrent-request limits are applied, but they are not equivalent to a total kernel memory cap. Preserve all unrelated workloads. Outstanding work includes intersection search, map completion, GO/UP credential validation, final current-candidate visual evidence, and complete release/handoff reconciliation.

Project-specific exceptions: web-only delivery and transit-focused functionality. No unrelated universal tools, desktop installer, payment or sign-in feature is part of this release.
