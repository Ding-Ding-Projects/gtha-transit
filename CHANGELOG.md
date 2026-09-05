# Changelog

## 0.1.0, unreleased

- Add the regional journey-planning interface and local saved-trip controls.
- Add official TTC alert ingestion with bounded reads and conservative unavailable states.
- Add Toronto timezone handling with explicit daylight-saving gap rejection and earlier repeated-time selection.
- Add static frontend container serving and private API proxy configuration.

This entry describes work in progress, not a verified public release. Commit references will be bound to the final integration at publication.

- Clarify exact versus representative vehicle photos visibly in directions and the tracker, with separate source and licence links.

- Replace the TTC LFS Hybrid representative image with a smaller, attribution-verified photo of vehicle 3539; mark it exact only for that fleet number.

- Remove two vehicle photo sources with conflicting attribution, including an oversized image that could not load through the proxy.

- Surface airport transit hubs in place search while preserving distinct stop coordinates. Empty journey results now retain neutral graph coverage context without guessing an agency from coordinates.

- Use actual map-database revisions in tile URLs, refresh both map surfaces every minute, and revalidate legacy tile paths rather than caching mutable content as immutable.

- Clear stale map-unavailable warnings after tile recovery or navigation, while preserving genuine current tile and metadata failures.
