# Implementation handoff

The initial version is under active implementation. The public hostname is not yet verified. The owner will configure DNS and the tunnel route after the origin service is ready.

The frontend and its static Node serving layer exist. Local TypeScript verification passes. Eleven focused tests cover Toronto date conversion, saved coordinates and TTC feed parsing. Local static compilation reaches prerender completion but its Node process exits with a Windows libuv shutdown assertion, so that command is not reported as a successful build. A Linux container build is the deployment verification path.

The routing lane has retrieved and validated eleven official GTFS archives and a Geofabrik Ontario extract on the designated private host. Graph building, actual itinerary validation and live deployment remain pending. Map and place production must use that real extract.

The TTC parser uses the official TTC website route-alert endpoint with the official GTFS-Realtime source as fallback. Content-update timestamps are metadata; receipt time controls website response freshness. Failed refreshes mark line states unknown. A live probe identified a real Line 1 service disruption. A later source snapshot may differ.

Known unfinished verification: real browser interactions, bilingual/narrow/high-scale layouts, map production and geocoding, complete journey/API validation, workload/resource measurements, rollback, public DNS and the final release. Do not infer success from files or fixture tests alone.

Project-specific exceptions: web-only delivery and transit-focused functionality. No unrelated universal tools, desktop installer, payment or sign-in feature is part of this release.
